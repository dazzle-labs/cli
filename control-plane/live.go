package main

import (
	"bytes"
	"database/sql"
	"fmt"
	"html/template"
	"log"
	"net"
	"net/http"
	"net/http/httputil"
	"net/url"
	"strings"
)

// --- Live stage queries ---

// dbListLiveStages returns all stages that currently have an active RTMP session.
func dbListLiveStages(db *sql.DB) ([]stageRow, error) {
	rows, err := db.Query(`
		SELECT `+stageColumns+`
		FROM stages s
		WHERE s.status = 'running'
		AND EXISTS (
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
	db.QueryRow(`SELECT EXISTS(
		SELECT 1 FROM stages s
		JOIN rtmp_sessions rs ON rs.stage_id = s.id
		WHERE s.id=$1 AND s.status='running' AND rs.ended_at IS NULL
	)`, stageID).Scan(&exists)
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

// pageMeta holds template data for rendering index.html.tmpl with dynamic meta tags.
// Vite bakes the asset tags directly into the template at build time, so this
// struct only contains the dynamic metadata fields.
type pageMeta struct {
	Title         string
	Description   string
	OGTitle       string
	OGDescription string
	OGImage       string
	OGUrl         string
	OGType        string
	TwitterCard   string
}

const (
	defaultTitle       = "Dazzle"
	defaultDescription = "A cloud stage for your AI agent, live on Twitch, YouTube, or a shareable link."
	defaultOGImage     = "https://dazzle.fm/og.png"
)

func defaultPageMeta() pageMeta {
	return pageMeta{
		Title:         defaultTitle,
		Description:   defaultDescription,
		OGTitle:       defaultTitle,
		OGDescription: defaultDescription,
		OGImage:       defaultOGImage,
		OGUrl:         "https://dazzle.fm",
		OGType:        "website",
		TwitterCard:   "summary_large_image",
	}
}

// initIndexTemplate parses the Vite-emitted index.html.tmpl (which already
// contains the hashed asset tags) and pre-renders a default page for SPA routes.
func initIndexTemplate(webDir string) (*template.Template, []byte, error) {
	tmpl, err := template.ParseFiles(webDir + "/index.html.tmpl")
	if err != nil {
		return nil, nil, fmt.Errorf("parsing index.html.tmpl: %w", err)
	}
	var buf bytes.Buffer
	if err := tmpl.Execute(&buf, defaultPageMeta()); err != nil {
		return nil, nil, fmt.Errorf("rendering default index: %w", err)
	}
	return tmpl, buf.Bytes(), nil
}

// serveWatchPage serves the SPA index.html with OG meta tags for social media crawlers.
func (m *Manager) serveWatchPage(w http.ResponseWriter, r *http.Request, slug string) {
	if m.indexTmpl == nil {
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	meta := defaultPageMeta()
	meta.OGType = "video.other"
	meta.OGUrl = r.URL.Path

	// Look up stage metadata
	if slug != "" && m.db != nil {
		if row, err := dbLookupStageBySlug(m.db, slug); err == nil && row != nil {
			title := row.Name
			if row.StreamTitle.Valid && row.StreamTitle.String != "" {
				title = row.StreamTitle.String
			}
			meta.Title = title + " — Dazzle"
			meta.OGTitle = title
			meta.TwitterCard = "summary_large_image"

			description := "Live on Dazzle"
			if row.StreamCategory.Valid && row.StreamCategory.String != "" {
				description = row.StreamCategory.String + " — Live on Dazzle"
			}
			meta.Description = description
			meta.OGDescription = description
			meta.OGImage = fmt.Sprintf("/watch/%s/thumbnail.png", slug)
		}
	}

	var buf bytes.Buffer
	if err := m.indexTmpl.Execute(&buf, meta); err != nil {
		log.Printf("ERROR: rendering watch page: %v", err)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache, no-store, must-revalidate")
	w.Write(buf.Bytes())
}
