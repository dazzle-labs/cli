package main

import (
	"database/sql"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// --- Database helpers for live streaming ---

func dbLookupStageBySlug(db *sql.DB, slug string) (*stageRow, error) {
	row := db.QueryRow(`SELECT `+stageColumns+` FROM stages WHERE slug=$1`, slug)
	s, err := scanStage(row)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return s, err
}

func dbCreateRTMPSession(db *sql.DB, stageID, userID, streamKey, clientIP, podIP string) error {
	_, err := db.Exec(`
		INSERT INTO rtmp_sessions (stage_id, user_id, stream_key, client_ip, pod_ip)
		VALUES ($1, $2, $3, $4, $5)`,
		stageID, userID, streamKey, clientIP, podIP)
	return err
}

func dbEndRTMPSession(db *sql.DB, stageID string) error {
	_, err := db.Exec(`
		UPDATE rtmp_sessions SET ended_at=NOW()
		WHERE stage_id=$1 AND ended_at IS NULL`, stageID)
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
// The publisher uses the stage ID as the RTMP stream name and passes
// the stream key as a query param:
//
//	rtmp://ingest.dazzle.fm/live/<stage_id>?key=<stream_key>
//
// nginx-rtmp POSTs form-encoded: name=<stage_id>&args=key=<stream_key>&addr=<client_ip>&app=live
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

	stageID := r.FormValue("name")
	addr := r.FormValue("addr")

	if stageID == "" {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	// Extract stream key from args (nginx-rtmp passes query params here)
	args := r.FormValue("args")
	var streamKey string
	for _, part := range strings.Split(args, "&") {
		if strings.HasPrefix(part, "key=") {
			streamKey = strings.TrimPrefix(part, "key=")
			break
		}
	}
	if streamKey == "" {
		log.Printf("INFO: rtmp on_publish rejected %s from %s (no stream key)", stageID, addr)
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	if m.db == nil {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
		return
	}

	// Validate: look up the stage and verify the stream key matches
	stage, err := dbGetStage(m.db, stageID)
	if err != nil {
		log.Printf("WARN: rtmp on_publish lookup error: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if stage == nil || !stage.StreamKey.Valid || stage.StreamKey.String != streamKey {
		log.Printf("INFO: rtmp on_publish rejected %s from %s (invalid key)", stageID, addr)
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	// The request comes from the ingest pod — capture its IP so the
	// HLS proxy can route directly to the correct pod.
	podIP, _, _ := net.SplitHostPort(r.RemoteAddr)

	if err := dbCreateRTMPSession(m.db, stageID, stage.UserID, stageID, addr, podIP); err != nil {
		log.Printf("WARN: rtmp on_publish failed to create session: %v", err)
	}

	// Cache the pod IP for fast HLS proxy lookups.
	m.ingestPodCache.Add(stageID, podIP)

	log.Printf("INFO: rtmp on_publish accepted stream for stage %s from %s (ingest pod %s)", stageID, addr, podIP)
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "ok")
}

// handleOnPublishDone is called by nginx-rtmp when a publisher disconnects.
// name is the stage ID (the RTMP stream name).
func (m *Manager) handleOnPublishDone(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	stageID := r.FormValue("name")
	if stageID == "" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if m.db != nil {
		m.ingestPodCache.Remove(stageID)
		if err := dbEndRTMPSession(m.db, stageID); err != nil {
			log.Printf("WARN: rtmp on_publish_done failed to end session for stage %s: %v", stageID, err)
		} else {
			log.Printf("INFO: rtmp on_publish_done ended session for stage %s", stageID)
		}
	}

	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "ok")
}

// handleWatchHLS proxies HLS for the public watch page.
// HLS is served from the ingest pod (nginx-rtmp), not the sidecar.
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

	// Resolve slug → stage.
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

	// Get the ingest pod IP for this stage's stream
	ingestIP := m.getIngestPodIP(row.ID)
	if ingestIP == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "stream not yet available"})
		return
	}

	// Proxy from ingest pod: HLS is at /hls/<stage_id>/<filename>
	// (the RTMP stream name is the stage ID, not the stream key)
	proxyTarget, _ := url.Parse(fmt.Sprintf("http://%s:8080", ingestIP))
	proxy := httputil.NewSingleHostReverseProxy(proxyTarget)

	r.URL.Path = "/hls/" + row.ID + "/" + filename
	r.URL.RawQuery = ""
	r.Host = proxyTarget.Host
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
