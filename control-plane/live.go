package main

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"os"
	"strconv"
	"strings"

	"github.com/lib/pq"
)

// --- Database helpers for live streaming ---

// dbLookupStageByStreamKey finds a stage by its stream key.
func dbLookupStageByStreamKey(db *sql.DB, streamKey string) (*stageRow, error) {
	var s stageRow
	err := db.QueryRow(`
		SELECT id, user_id, name, status, pod_name, pod_ip, destination_id, preview_token, provider, runpod_pod_id, sidecar_url, gpu_node_name, capabilities, created_at, updated_at, stream_key, slug, stream_title, stream_category
		FROM stages WHERE stream_key=$1`, streamKey).Scan(
		&s.ID, &s.UserID, &s.Name, &s.Status, &s.PodName, &s.PodIP,
		&s.DestinationID, &s.PreviewToken, &s.Provider, &s.RunPodPodID,
		&s.SidecarURL, &s.GPUNodeName, pq.Array(&s.Capabilities),
		&s.CreatedAt, &s.UpdatedAt, &s.StreamKey, &s.Slug, &s.StreamTitle, &s.StreamCategory)
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
		SELECT id, user_id, name, status, pod_name, pod_ip, destination_id, preview_token, provider, runpod_pod_id, sidecar_url, gpu_node_name, capabilities, created_at, updated_at, stream_key, slug, stream_title, stream_category
		FROM stages WHERE slug=$1`, slug).Scan(
		&s.ID, &s.UserID, &s.Name, &s.Status, &s.PodName, &s.PodIP,
		&s.DestinationID, &s.PreviewToken, &s.Provider, &s.RunPodPodID,
		&s.SidecarURL, &s.GPUNodeName, pq.Array(&s.Capabilities),
		&s.CreatedAt, &s.UpdatedAt, &s.StreamKey, &s.Slug, &s.StreamTitle, &s.StreamCategory)
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

// handleWatchThumbnail proxies the thumbnail from the stage's sidecar for public OG images.
func (m *Manager) handleWatchThumbnail(w http.ResponseWriter, r *http.Request, slug string) {
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
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	target := stageProxyTarget(stage)
	proxy := httputil.NewSingleHostReverseProxy(target)
	if target.Scheme == "https" && m.agentHTTPClient != nil && m.agentHTTPClient.Transport != nil {
		proxy.Transport = m.agentHTTPClient.Transport
	}
	w.Header().Set("Cache-Control", "public, max-age=5")
	r.URL.Path = "/_dz_9f7a3b1c/thumbnail.png"
	r.URL.RawQuery = ""
	r.Host = target.Host
	r.Header.Del("Authorization")
	proxy.ServeHTTP(w, r)
}

// serveWatchPage serves the SPA index.html with OG meta tags injected for social media crawlers.
func (m *Manager) serveWatchPage(w http.ResponseWriter, r *http.Request, slug string) {
	// Read the built index.html
	indexBytes, err := os.ReadFile("web/index.html")
	if err != nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	html := string(indexBytes)

	// Try to look up stage metadata for OG tags
	var title, category, ogImage string
	if slug != "" && m.db != nil {
		if row, err := dbLookupStageBySlug(m.db, slug); err == nil && row != nil {
			title = row.Name
			if row.StreamTitle.Valid && row.StreamTitle.String != "" {
				title = row.StreamTitle.String
			}
			if row.StreamCategory.Valid {
				category = row.StreamCategory.String
			}
			ogImage = fmt.Sprintf("/watch/%s/thumbnail.png", slug)
		}
	}

	if title == "" {
		title = "Dazzle"
	}
	description := "Live on Dazzle"
	if category != "" {
		description = category + " — Live on Dazzle"
	}

	// Build OG meta tags
	ogTags := fmt.Sprintf(`<meta property="og:title" content="%s" />
    <meta property="og:description" content="%s" />
    <meta property="og:type" content="video.other" />
    <meta property="og:url" content="%s" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="%s" />
    <meta name="twitter:description" content="%s" />`,
		htmlEscape(title), htmlEscape(description),
		htmlEscape(r.URL.Path),
		htmlEscape(title), htmlEscape(description))

	if ogImage != "" {
		ogTags += fmt.Sprintf(`
    <meta property="og:image" content="%s" />
    <meta name="twitter:image" content="%s" />`, htmlEscape(ogImage), htmlEscape(ogImage))
	}

	// Also update <title>
	html = strings.Replace(html, "<title>Dazzle</title>", "<title>"+htmlEscape(title)+" — Dazzle</title>", 1)

	// Inject OG tags after <head>
	html = strings.Replace(html, "<head>", "<head>\n    "+ogTags, 1)

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Write([]byte(html))
}

// htmlEscape escapes HTML special characters for safe inclusion in HTML attributes.
func htmlEscape(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	s = strings.ReplaceAll(s, `"`, "&quot;")
	return s
}
