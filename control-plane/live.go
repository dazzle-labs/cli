package main

import (
	"database/sql"
	"fmt"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"os"
	"strings"
)

// --- Live stage queries ---

// dbListLiveStages returns all stages that currently have an active RTMP session.
func dbListLiveStages(db *sql.DB) ([]stageRow, error) {
	rows, err := db.Query(`
		SELECT `+stageColumns+`
		FROM stages s
		WHERE EXISTS (
			SELECT 1 FROM rtmp_sessions rs
			WHERE rs.stage_id = s.id AND rs.ended_at IS NULL
		)
		ORDER BY s.featured DESC, s.created_at`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var stages []stageRow
	for rows.Next() {
		s, err := scanStage(rows)
		if err != nil {
			return nil, err
		}
		stages = append(stages, *s)
	}
	return stages, rows.Err()
}

// dbStageIsLive returns true if a stage has an active RTMP session.
func dbStageIsLive(db *sql.DB, stageID string) bool {
	var exists bool
	db.QueryRow(`SELECT EXISTS(SELECT 1 FROM rtmp_sessions WHERE stage_id=$1 AND ended_at IS NULL)`, stageID).Scan(&exists)
	return exists
}

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
// The stream key IS the RTMP publish name (like Twitch/Kick):
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

	streamKey := r.FormValue("name")
	addr := r.FormValue("addr")

	if streamKey == "" {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	if m.db == nil {
		http.Error(w, "service unavailable", http.StatusServiceUnavailable)
		return
	}

	// Look up stage by stream key
	stage, err := dbGetStageByStreamKey(m.db, streamKey)
	if err != nil {
		log.Printf("WARN: rtmp on_publish lookup error: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	if stage == nil {
		log.Printf("INFO: rtmp on_publish rejected from %s (invalid key)", addr)
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}

	// The request comes from the ingest pod — capture its IP so the
	// HLS proxy can route directly to the correct pod.
	podIP, _, _ := net.SplitHostPort(r.RemoteAddr)

	if err := dbCreateRTMPSession(m.db, stage.ID, stage.UserID, streamKey, addr, podIP); err != nil {
		log.Printf("WARN: rtmp on_publish failed to create session: %v", err)
	}

	// Cache the pod IP for fast HLS proxy lookups.
	m.ingestPodCache.Add(stage.ID, podIP)

	log.Printf("INFO: rtmp on_publish accepted stream for stage %s from %s (ingest pod %s)", stage.ID, addr, podIP)
	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "ok")
}

// handleOnPublishDone is called by nginx-rtmp when a publisher disconnects.
// name is the stream key (the RTMP publish name).
func (m *Manager) handleOnPublishDone(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad request", http.StatusBadRequest)
		return
	}

	streamKey := r.FormValue("name")
	if streamKey == "" {
		w.WriteHeader(http.StatusOK)
		return
	}

	if m.db != nil {
		stage, err := dbGetStageByStreamKey(m.db, streamKey)
		if err == nil && stage != nil {
			m.ingestPodCache.Remove(stage.ID)
			if err := dbEndRTMPSession(m.db, stage.ID); err != nil {
				log.Printf("WARN: rtmp on_publish_done failed to end session for stage %s: %v", stage.ID, err)
			} else {
				log.Printf("INFO: rtmp on_publish_done ended session for stage %s", stage.ID)
			}
		}
	}

	w.WriteHeader(http.StatusOK)
	fmt.Fprint(w, "ok")
}

// parseWatchHLSPath extracts (slug, filename) from HLS watch paths.
// Supports:
//
//	/watch/<slug>/index.m3u8       → (slug, "index.m3u8")
//	/watch/<slug>/42.ts            → (slug, "42.ts")
//	/watch/<slug>/hls/index.m3u8   → (slug, "index.m3u8")   [legacy]
//	/watch/<slug>/hls/42.ts        → (slug, "42.ts")         [legacy]
func parseWatchHLSPath(path string) (slug, filename string, ok bool) {
	path = strings.TrimPrefix(path, "/watch/")
	parts := strings.Split(path, "/")
	if len(parts) < 2 {
		return "", "", false
	}
	slug = parts[0]

	// Legacy /watch/<slug>/hls/<file>
	if len(parts) >= 3 && parts[1] == "hls" {
		filename = parts[2]
	} else {
		filename = parts[1]
	}

	// Sanitize
	if filename == "" || strings.Contains(filename, "/") || strings.Contains(filename, "..") {
		return "", "", false
	}
	if !strings.HasSuffix(filename, ".m3u8") && !strings.HasSuffix(filename, ".ts") {
		return "", "", false
	}
	return slug, filename, true
}

// handleWatchHLS proxies HLS for the public watch page.
// HLS is served from the ingest pod (nginx-rtmp), not the sidecar.
//
// nginx-rtmp with hls_nested writes to /tmp/hls/<stream_key>/:
//   index.m3u8, index-0.ts, index-1.ts, ...
//
// The m3u8 uses relative refs (index-0.ts) so no rewriting is needed —
// the browser resolves them relative to the m3u8 URL. The proxy just
// maps the slug to the stream key directory:
//
//	/watch/<slug>/index.m3u8    →  /hls/<stream_key>/index.m3u8
//	/watch/<slug>/index-42.ts   →  /hls/<stream_key>/index-42.ts
func (m *Manager) handleWatchHLS(w http.ResponseWriter, r *http.Request, slug, filename string) {
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

	ingestIP := m.getIngestPodIP(row.ID)
	if ingestIP == "" {
		writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "stream not yet available"})
		return
	}

	if !row.StreamKey.Valid || row.StreamKey.String == "" {
		http.Error(w, "stream not configured", http.StatusServiceUnavailable)
		return
	}

	proxyTarget, _ := url.Parse(fmt.Sprintf("http://%s:8080", ingestIP))
	proxy := httputil.NewSingleHostReverseProxy(proxyTarget)

	r.URL.Path = "/hls/" + row.StreamKey.String + "/" + filename
	r.URL.RawQuery = ""
	r.Host = proxyTarget.Host
	r.Header.Del("Authorization")

	w.Header().Set("Cache-Control", "no-cache")
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
