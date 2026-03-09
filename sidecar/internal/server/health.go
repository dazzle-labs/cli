package server

import (
	"encoding/json"
	"net/http"
	"time"
)

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]any{
		"status":       "ok",
		"lastActivity": s.lastActivity.Unix(),
		"uptime":       time.Since(s.lastActivity).Seconds(),
	})
}
