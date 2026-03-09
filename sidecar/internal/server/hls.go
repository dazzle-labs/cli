package server

import (
	"net/http"
	"strings"
)

func (s *Server) handleHLS(w http.ResponseWriter, r *http.Request) {
	// Path has already been stripped of the prefix by StripPrefix.
	// We get /hls/<filename>
	filename := strings.TrimPrefix(r.URL.Path, "/hls/")
	if filename == "" {
		http.NotFound(w, r)
		return
	}

	// Serve from HLS directory (read-only, written by ffmpeg in streamer container)
	http.ServeFile(w, r, s.cfg.HLSDir+"/"+filename)
}
