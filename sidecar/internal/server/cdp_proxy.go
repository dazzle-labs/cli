package server

import (
	"fmt"
	"io"
	"net/http"
	"strings"
)

func (s *Server) handleCDPProxy(w http.ResponseWriter, r *http.Request) {
	// Path has already been stripped of the prefix by StripPrefix.
	// We get /cdp/<subpath>
	subPath := strings.TrimPrefix(r.URL.Path, "/cdp")

	cdpURL := fmt.Sprintf("http://%s:%s%s", s.cfg.CDPHost, s.cfg.CDPPort, subPath)

	resp, err := http.Get(cdpURL)
	if err != nil {
		http.Error(w, `{"error":"CDP not available"}`, http.StatusBadGateway)
		return
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	// Rewrite WebSocket URLs to point through sidecar
	extHost := r.Header.Get("Host")
	if extHost == "" {
		extHost = r.Host
	}
	rewritten := strings.ReplaceAll(string(body),
		fmt.Sprintf("ws://localhost:%s", s.cfg.CDPPort),
		fmt.Sprintf("ws://%s", extHost))

	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/json"
	}
	w.Header().Set("Content-Type", contentType)
	w.Write([]byte(rewritten))
}
