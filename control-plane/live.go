package main

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"strconv"
	"strings"

	"github.com/lib/pq"
)

// --- Database helpers for live streaming ---

// dbLookupStageByStreamKey finds a stage by its stream key.
func dbLookupStageByStreamKey(db *sql.DB, streamKey string) (*stageRow, error) {
	var s stageRow
	err := db.QueryRow(`
		SELECT id, user_id, name, status, pod_name, pod_ip, destination_id, preview_token, provider, runpod_pod_id, sidecar_url, gpu_node_name, capabilities, created_at, updated_at, stream_key, slug
		FROM stages WHERE stream_key=$1`, streamKey).Scan(
		&s.ID, &s.UserID, &s.Name, &s.Status, &s.PodName, &s.PodIP,
		&s.DestinationID, &s.PreviewToken, &s.Provider, &s.RunPodPodID,
		&s.SidecarURL, &s.GPUNodeName, pq.Array(&s.Capabilities),
		&s.CreatedAt, &s.UpdatedAt, &s.StreamKey, &s.Slug)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func dbLookupStageBySlug(db *sql.DB, slug string) (*stageRow, error) {
	var s stageRow
	err := db.QueryRow(`
		SELECT id, user_id, name, status, pod_name, pod_ip, destination_id, preview_token, provider, runpod_pod_id, sidecar_url, gpu_node_name, capabilities, created_at, updated_at, stream_key, slug
		FROM stages WHERE slug=$1`, slug).Scan(
		&s.ID, &s.UserID, &s.Name, &s.Status, &s.PodName, &s.PodIP,
		&s.DestinationID, &s.PreviewToken, &s.Provider, &s.RunPodPodID,
		&s.SidecarURL, &s.GPUNodeName, pq.Array(&s.Capabilities),
		&s.CreatedAt, &s.UpdatedAt, &s.StreamKey, &s.Slug)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &s, nil
}

func dbCreateRTMPSession(db *sql.DB, stageID, userID, streamKey, clientIP, podIP string) error {
	_, err := db.Exec(`
		INSERT INTO rtmp_sessions (stage_id, user_id, stream_key, client_ip, pod_ip)
		VALUES ($1, $2, $3, $4, $5)`,
		stageID, userID, streamKey, clientIP, podIP)
	return err
}

func dbEndRTMPSession(db *sql.DB, streamKey string) error {
	_, err := db.Exec(`
		UPDATE rtmp_sessions SET ended_at=NOW()
		WHERE stream_key=$1 AND ended_at IS NULL`, streamKey)
	return err
}

// dbGetActiveIngestPodIP returns the ingest pod IP serving a given stage's stream.
func dbGetActiveIngestPodIP(db *sql.DB, stageID string) string {
	var podIP string
	err := db.QueryRow(`
		SELECT pod_ip FROM rtmp_sessions
		WHERE stage_id=$1 AND ended_at IS NULL
		ORDER BY started_at DESC LIMIT 1`, stageID).Scan(&podIP)
	if err != nil {
		return ""
	}
	return podIP
}

// getIngestPodIP returns the ingest pod IP for a stage, checking cache first.
func (m *Manager) getIngestPodIP(stageID string) string {
	if ip, ok := m.ingestPodCache.Get(stageID); ok {
		return ip
	}
	if m.db == nil {
		return ""
	}
	ip := dbGetActiveIngestPodIP(m.db, stageID)
	if ip != "" {
		m.ingestPodCache.Add(stageID, ip)
	}
	return ip
}

// --- HTTP handlers for nginx-rtmp callbacks ---

// handleOnPublish is called by nginx-rtmp when a publisher connects.
// The publisher uses the stage's stream key as the RTMP stream name:
//
//	rtmp://ingest.dazzle.fm/live/<stream_key>
//
// nginx-rtmp POSTs form-encoded: name=<stream_key>&addr=<client_ip>&app=live
// Return 200 to allow, non-200 to reject.
func (m *Manager) handleOnPublish(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	name := r.FormValue("name")
	addr := r.FormValue("addr")

	if name == "" {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	if m.db == nil {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
		return
	}

	stage, err := dbLookupStageByStreamKey(m.db, name)
	if err != nil {
		log.Printf("WARN: rtmp on_publish lookup error: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if stage == nil {
		log.Printf("INFO: rtmp on_publish rejected unknown stream key from %s", addr)
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	// The request comes from the ingest pod — capture its IP so the
	// HLS proxy can route directly to the correct pod.
	podIP, _, _ := net.SplitHostPort(r.RemoteAddr)

	if err := dbCreateRTMPSession(m.db, stage.ID, stage.UserID, name, addr, podIP); err != nil {
		log.Printf("WARN: rtmp on_publish failed to create session: %v", err)
	}

	// Cache the pod IP for fast HLS proxy lookups.
	m.ingestPodCache.Add(stage.ID, podIP)

	log.Printf("INFO: rtmp on_publish accepted stream for stage %s from %s (ingest pod %s)", stage.ID, addr, podIP)
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "ok")
}

// handleOnPublishDone is called by nginx-rtmp when a publisher disconnects.
func (m *Manager) handleOnPublishDone(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	name := r.FormValue("name")
	if name == "" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if m.db != nil {
		// Look up stage before ending session so we can evict the cache.
		if stage, err := dbLookupStageByStreamKey(m.db, name); err == nil && stage != nil {
			m.ingestPodCache.Remove(stage.ID)
		}
		if err := dbEndRTMPSession(m.db, name); err != nil {
			log.Printf("WARN: rtmp on_publish_done failed to end session: %v", err)
		} else {
			log.Printf("INFO: rtmp on_publish_done ended session for key %s", maskStreamKey(name))
		}
	}

	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "ok")
}

// handleWatchHLS proxies HLS for the public watch page.
// When a stage is running, its HLS is publicly viewable without auth.
// Route: /watch/{slug}/hls/{filename}
func (m *Manager) handleWatchHLS(w http.ResponseWriter, r *http.Request) {
	parts := strings.SplitN(strings.TrimPrefix(r.URL.Path, "/watch/"), "/", 3)
	if len(parts) < 3 {
		http.Error(w, "invalid path", http.StatusBadRequest)
		return
	}
	slug := parts[0]
	// parts[1] == "hls"
	filename := parts[2]

	// Path sanitization
	if strings.Contains(filename, "/") || strings.Contains(filename, "..") {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	if !strings.HasSuffix(filename, ".m3u8") && !strings.HasSuffix(filename, ".ts") {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	// Resolve slug → stage ID.
	if m.db == nil {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
		return
	}
	row, err := dbLookupStageBySlug(m.db, slug)
	if err != nil || row == nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}

	stage, ok := m.getStage(row.ID)
	if !ok || !stageIsReady(stage) {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "stage not active"})
		return
	}

	target := stageProxyTarget(stage)
	proxy := httputil.NewSingleHostReverseProxy(target)
	if target.Scheme == "https" && m.agentHTTPClient != nil && m.agentHTTPClient.Transport != nil {
		proxy.Transport = m.agentHTTPClient.Transport
	}
	r.URL.Path = "/_dz_9f7a3b1c/hls/" + filename
	r.URL.RawQuery = ""
	r.Host = target.Host
	r.Header.Del("Authorization")

	if strings.HasSuffix(filename, ".m3u8") {
		proxy.ModifyResponse = func(resp *http.Response) error {
			if resp.StatusCode != http.StatusOK {
				return nil
			}
			body, err := io.ReadAll(resp.Body)
			resp.Body.Close()
			if err != nil {
				return err
			}
			lines := strings.Split(string(body), "\n")
			for i, line := range lines {
				if line == "" || strings.HasPrefix(line, "#") {
					continue
				}
				lines[i] = "/watch/" + slug + "/hls/" + line
			}
			modified := []byte(strings.Join(lines, "\n"))
			resp.Body = io.NopCloser(strings.NewReader(string(modified)))
			resp.ContentLength = int64(len(modified))
			resp.Header.Set("Content-Length", strconv.Itoa(len(modified)))
			return nil
		}
	}

	proxy.ServeHTTP(w, r)
}
