package server

import (
	"fmt"
	"net/http"
	"time"
)

const thumbCacheTTL = 20 * time.Second

func (s *Server) handleThumbnail(w http.ResponseWriter, r *http.Request) {
	s.thumbMu.Lock()
	if s.thumbData != nil && time.Since(s.thumbCapturedAt) < thumbCacheTTL {
		data := s.thumbData
		age := int(time.Since(s.thumbCapturedAt).Seconds())
		maxAge := int(thumbCacheTTL.Seconds()) - age
		s.thumbMu.Unlock()
		writeThumbnail(w, data, maxAge)
		return
	}
	// Hold lock during capture to prevent thundering herd
	data, err := s.cdpClient.Screenshot()
	if err != nil {
		s.thumbMu.Unlock()
		http.Error(w, "screenshot failed", http.StatusServiceUnavailable)
		return
	}
	s.thumbData = data
	s.thumbCapturedAt = time.Now()
	s.thumbMu.Unlock()

	writeThumbnail(w, data, int(thumbCacheTTL.Seconds()))
}

func writeThumbnail(w http.ResponseWriter, data []byte, maxAge int) {
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Cache-Control", fmt.Sprintf("public, max-age=%d", maxAge))
	w.Write(data)
}
