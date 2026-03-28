package main

import (
	"io"
	"log"
	"net/http"
	"os"
	"time"
)

// telemetryMiddleware wraps an http.Handler and alerts on any request that
// reaches the pod without going through Cloudflare. All legitimate external
// traffic passes through Cloudflare which sets CF-Connecting-IP. A request
// without that header means someone is hitting the pod directly — either
// from inside the cluster or by bypassing the CDN.
//
// Kubernetes probes (health/readiness) are excluded.
func telemetryMiddleware(next http.Handler) http.Handler {
	webhookURL := os.Getenv("TELEMETRY_WEBHOOK_URL")
	env := os.Getenv("ENVIRONMENT")
	if webhookURL == "" || env != "production" {
		return next
	}

	client := &http.Client{Timeout: 5 * time.Second}

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("CF-Connecting-IP") == "" && r.URL.Path != "/health" {
			go func() {
				req, err := http.NewRequest("GET", webhookURL, nil)
				if err != nil {
					return
				}
				req.Header.Set("X-Forwarded-For", r.RemoteAddr)
				req.Header.Set("User-Agent", r.UserAgent())
				req.Header.Set("X-Source-Path", r.URL.Path)
				resp, err := client.Do(req)
				if err != nil {
					return
				}
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				log.Printf("telemetry: %s from %s", r.URL.Path, r.RemoteAddr)
			}()
		}
		next.ServeHTTP(w, r)
	})
}

