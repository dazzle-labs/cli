package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/clerk/clerk-sdk-go/v2/user"
)

// --- Rate limiter ---

type rateLimiter struct {
	mu       sync.Mutex
	counters map[string]*rateBucket
}

type rateBucket struct {
	count     int
	resetAt   time.Time
}

func newRateLimiter() *rateLimiter {
	return &rateLimiter{counters: make(map[string]*rateBucket)}
}

func (rl *rateLimiter) allow(ip string, limit int, window time.Duration) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()

	now := time.Now()

	// Evict expired entries periodically (every 100 calls)
	if len(rl.counters) > 100 {
		for k, v := range rl.counters {
			if now.After(v.resetAt) {
				delete(rl.counters, k)
			}
		}
	}

	b, ok := rl.counters[ip]
	if !ok || now.After(b.resetAt) {
		rl.counters[ip] = &rateBucket{count: 1, resetAt: now.Add(window)}
		return true
	}
	b.count++
	return b.count <= limit
}

var keyNameRegex = regexp.MustCompile(`^[a-zA-Z0-9-]{1,64}$`)

// clientIP extracts the client IP, checking proxy headers first.
func clientIP(r *http.Request) string {
	if ip := r.Header.Get("X-Real-IP"); ip != "" {
		return ip
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.SplitN(xff, ",", 2)
		return strings.TrimSpace(parts[0])
	}
	// r.RemoteAddr is "ip:port"
	if idx := strings.LastIndex(r.RemoteAddr, ":"); idx != -1 {
		return r.RemoteAddr[:idx]
	}
	return r.RemoteAddr
}

func (mgr *Manager) handleCreateCliSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Rate limit: 10 requests/min per IP
	if !mgr.cliSessionRL.allow(clientIP(r), 10, time.Minute) {
		http.Error(w, `{"error":"rate limit exceeded"}`, http.StatusTooManyRequests)
		return
	}

	var body struct {
		Type       string `json:"type"`
		KeyName    string `json:"key_name"`
		Platform   string `json:"platform"`
		VerifyCode string `json:"verify_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}

	if body.Type != "login" && body.Type != "destination" {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "type must be 'login' or 'destination'"})
		return
	}

	if body.Type == "login" {
		if body.KeyName == "" {
			body.KeyName = "CLI"
		}
		if !keyNameRegex.MatchString(body.KeyName) {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid key name — alphanumeric and hyphens only, max 64 chars"})
			return
		}
	}

	if body.Type == "destination" {
		// Requires auth
		token := extractBearerToken(r)
		info, err := mgr.auth.authenticate(r.Context(), token)
		if err != nil || info == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}

		if body.Platform == "" {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": "platform is required for destination sessions"})
			return
		}

		// Validate platform OAuth is configured
		if _, ok := mgr.oauth.configs[body.Platform]; !ok {
			writeJSON(w, http.StatusBadRequest, map[string]string{"error": body.Platform + " OAuth is not configured on this server"})
			return
		}

		if mgr.publicBaseURL == "" {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "publicBaseURL not configured"})
			return
		}

		session := mgr.cliSessions.create(body.Type, "", body.Platform, body.VerifyCode, info.UserID)

		// Generate short-lived auth token for the browser URL
		authToken := mgr.cliSessions.createAuthToken(info.UserID)

		browserURL := fmt.Sprintf("%s/oauth/%s/authorize?auth_token=%s&cli_session=%s",
			mgr.publicBaseURL, body.Platform, authToken, session.ID)

		writeJSON(w, http.StatusOK, map[string]any{
			"session_id":  session.ID,
			"browser_url": browserURL,
			"expires_at":  session.CreatedAt.Add(10 * time.Minute).Format(time.RFC3339),
		})
		return
	}

	// Login session — no auth required
	if mgr.publicBaseURL == "" {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "publicBaseURL not configured"})
		return
	}

	session := mgr.cliSessions.create(body.Type, body.KeyName, "", body.VerifyCode, "")

	browserURL := fmt.Sprintf("%s/auth/cli/%s", mgr.publicBaseURL, session.ID)

	writeJSON(w, http.StatusOK, map[string]any{
		"session_id":  session.ID,
		"browser_url": browserURL,
		"expires_at":  session.CreatedAt.Add(10 * time.Minute).Format(time.RFC3339),
	})
}

func (mgr *Manager) handlePollCliSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")
	snap, err := mgr.cliSessions.poll(id)
	if err != nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return
	}

	if snap.Status == "expired" {
		writeJSON(w, http.StatusOK, map[string]string{"status": "expired"})
		return
	}

	if snap.Status == "complete" {
		// Consume — one-time read
		consumed, err := mgr.cliSessions.consume(id)
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]string{"status": "pending"})
			return
		}
		resp := map[string]any{"status": "complete"}
		if consumed.Result != nil {
			if consumed.Result.Token != "" {
				resp["token"] = consumed.Result.Token
			}
			if consumed.Result.Email != "" {
				resp["email"] = consumed.Result.Email
			}
			if consumed.Result.KeyName != "" {
				resp["key_name"] = consumed.Result.KeyName
			}
			if consumed.Result.Platform != "" {
				resp["platform"] = consumed.Result.Platform
			}
			if consumed.Result.PlatformUsername != "" {
				resp["platform_username"] = consumed.Result.PlatformUsername
			}
		}
		writeJSON(w, http.StatusOK, resp)
		return
	}

	// Pending — include type info for the web page
	resp := map[string]string{"status": "pending", "type": snap.Type}
	if snap.KeyName != "" {
		resp["key_name"] = snap.KeyName
	}
	writeJSON(w, http.StatusOK, resp)
}

func (mgr *Manager) handleConfirmCliSession(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	id := r.PathValue("id")

	var body struct {
		VerifyCode string `json:"verify_code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON"})
		return
	}

	session := mgr.cliSessions.get(id)
	if session == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return
	}

	session.mu.Lock()
	if session.Status != "pending" {
		session.mu.Unlock()
		writeJSON(w, http.StatusConflict, map[string]string{"error": "session already completed"})
		return
	}
	sessionType := session.Type
	verifyCode := session.VerifyCode
	keyName := session.KeyName
	pending := session.PendingResult
	session.mu.Unlock()

	// Verify code
	if body.VerifyCode == "" || body.VerifyCode != verifyCode {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "verification code mismatch"})
		return
	}

	if sessionType == "login" {
		// Login confirm requires Clerk auth
		token := extractBearerToken(r)
		info, err := mgr.auth.authenticate(r.Context(), token)
		if err != nil || info == nil || info.Method != authMethodClerk {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "Clerk authentication required"})
			return
		}

		// Rotate API key
		_, secret, _, err := dbRotateAPIKey(mgr.db, info.UserID, keyName)
		if err != nil {
			log.Printf("Failed to rotate API key for user %s: %v", info.UserID, err)
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to create API key"})
			return
		}

		// Resolve user email
		email := ""
		if dbEmail, _, _, _, dbErr := dbGetUserProfile(mgr.db, info.UserID); dbErr == nil && dbEmail != "" {
			email = dbEmail
		}
		if email == "" {
			// Fallback to Clerk API
			clerkUser, clerkErr := user.Get(context.Background(), info.UserID)
			if clerkErr == nil && clerkUser != nil {
				for _, ea := range clerkUser.EmailAddresses {
					if ea.ID == *clerkUser.PrimaryEmailAddressID {
						email = ea.EmailAddress
						break
					}
				}
			}
		}

		if err := mgr.cliSessions.complete(id, &cliSessionResult{
			Token:   secret,
			Email:   email,
			KeyName: keyName,
		}); err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "key_name": keyName})
		return
	}

	if sessionType == "destination" {
		// Destination confirm: no Clerk auth, but PendingResult must be set by OAuth callback
		if pending == nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": "OAuth flow not yet completed"})
			return
		}

		if err := mgr.cliSessions.complete(id, pending); err != nil {
			writeJSON(w, http.StatusConflict, map[string]string{"error": err.Error()})
			return
		}

		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
		return
	}

	writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unknown session type"})
}

func (mgr *Manager) handleCliSessionInfo(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	// Requires Clerk auth
	token := extractBearerToken(r)
	info, err := mgr.auth.authenticate(r.Context(), token)
	if err != nil || info == nil {
		writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
		return
	}

	id := r.PathValue("id")
	session := mgr.cliSessions.get(id)
	if session == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return
	}

	session.mu.Lock()
	// For destination sessions, verify the authenticated user owns this session
	if session.UserID != "" && session.UserID != info.UserID {
		session.mu.Unlock()
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "session not found"})
		return
	}
	resp := map[string]string{
		"type":        session.Type,
		"key_name":    session.KeyName,
		"verify_code": session.VerifyCode,
		"status":      session.Status,
	}
	session.mu.Unlock()

	writeJSON(w, http.StatusOK, resp)
}

