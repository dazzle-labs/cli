package main

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// oauthPlatformConfig holds per-platform OAuth settings.
type oauthPlatformConfig struct {
	ClientID     string
	ClientSecret string
	AuthURL      string
	TokenURL     string
	Scopes       string
	UserInfoFunc func(accessToken, clientID string) (platformUserID, username string, err error)
}

// oauthState stores pending auth flow state.
type oauthState struct {
	UserID       string
	CodeVerifier string
	Onboarding   bool
	CliSessionID string
	CreatedAt    time.Time
}

const redisOAuthPrefix = "oauth:state:"

// oauthHandler manages OAuth flows for all platforms.
type oauthHandler struct {
	mgr          *Manager
	rdb          *redis.Client
	configs      map[string]*oauthPlatformConfig
	states       sync.Map // state string -> *oauthState (in-memory fallback)
	redirectBase string
}

func newOAuthHandler(mgr *Manager) *oauthHandler {
	h := &oauthHandler{
		mgr:          mgr,
		rdb:          mgr.rdb,
		configs:      make(map[string]*oauthPlatformConfig),
		redirectBase: os.Getenv("OAUTH_REDIRECT_BASE_URL"),
	}

	if id, secret := os.Getenv("TWITCH_CLIENT_ID"), os.Getenv("TWITCH_CLIENT_SECRET"); id != "" && secret != "" {
		h.configs["twitch"] = &oauthPlatformConfig{
			ClientID:     id,
			ClientSecret: secret,
			AuthURL:      "https://id.twitch.tv/oauth2/authorize",
			TokenURL:     "https://id.twitch.tv/oauth2/token",
			Scopes:       "channel:manage:broadcast channel:read:stream_key user:read:chat user:write:chat",
			UserInfoFunc: fetchTwitchUserInfo,
		}
	}

	if id, secret := os.Getenv("GOOGLE_CLIENT_ID"), os.Getenv("GOOGLE_CLIENT_SECRET"); id != "" && secret != "" {
		h.configs["youtube"] = &oauthPlatformConfig{
			ClientID:     id,
			ClientSecret: secret,
			AuthURL:      "https://accounts.google.com/o/oauth2/v2/auth",
			TokenURL:     "https://oauth2.googleapis.com/token",
			Scopes:       "https://www.googleapis.com/auth/youtube.force-ssl",
			UserInfoFunc: fetchYouTubeUserInfo,
		}
	}

	if id, secret := os.Getenv("KICK_CLIENT_ID"), os.Getenv("KICK_CLIENT_SECRET"); id != "" && secret != "" {
		h.configs["kick"] = &oauthPlatformConfig{
			ClientID:     id,
			ClientSecret: secret,
			AuthURL:      "https://id.kick.com/oauth/authorize",
			TokenURL:     "https://id.kick.com/oauth/token",
			Scopes:       "channel:read channel:write streamkey:read chat:write events:subscribe",
			UserInfoFunc: fetchKickUserInfo,
		}
	}

	if id, secret := os.Getenv("RESTREAM_CLIENT_ID"), os.Getenv("RESTREAM_CLIENT_SECRET"); id != "" && secret != "" {
		h.configs["restream"] = &oauthPlatformConfig{
			ClientID:     id,
			ClientSecret: secret,
			AuthURL:      "https://api.restream.io/login",
			TokenURL:     "https://api.restream.io/oauth/token",
			Scopes:       "",
			UserInfoFunc: fetchRestreamUserInfo,
		}
	}

	// In-memory cleanup only needed when Redis is not available.
	if h.rdb == nil {
		go func() {
			for {
				time.Sleep(time.Minute)
				h.states.Range(func(key, value any) bool {
					if s, ok := value.(*oauthState); ok && time.Since(s.CreatedAt) > 10*time.Minute {
						h.states.Delete(key)
					}
					return true
				})
			}
		}()
	}

	return h
}

func (h *oauthHandler) availablePlatforms() []string {
	var platforms []string
	for p := range h.configs {
		platforms = append(platforms, p)
	}
	return platforms
}

// oauthStateRedis is the JSON form stored in Redis.
type oauthStateRedis struct {
	UserID       string `json:"user_id"`
	CodeVerifier string `json:"code_verifier"`
	Onboarding   bool   `json:"onboarding"`
	CliSessionID string `json:"cli_session_id,omitempty"`
	CreatedAt    int64  `json:"created_at"`
}

func (h *oauthHandler) storeState(state string, s *oauthState) {
	if h.rdb != nil {
		data, _ := json.Marshal(&oauthStateRedis{
			UserID:       s.UserID,
			CodeVerifier: s.CodeVerifier,
			Onboarding:   s.Onboarding,
			CliSessionID: s.CliSessionID,
			CreatedAt:    s.CreatedAt.UnixMilli(),
		})
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		h.rdb.Set(ctx, redisOAuthPrefix+state, data, 10*time.Minute)
		return
	}
	h.states.Store(state, s)
}

var redisLoadAndDeleteOAuth = redis.NewScript(`
local v = redis.call("GET", KEYS[1])
if not v then return nil end
redis.call("DEL", KEYS[1])
return v
`)

func (h *oauthHandler) loadAndDeleteState(state string) (*oauthState, bool) {
	if h.rdb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		raw, err := redisLoadAndDeleteOAuth.Run(ctx, h.rdb, []string{redisOAuthPrefix + state}).Result()
		if err != nil {
			return nil, false
		}
		result, ok := raw.(string)
		if !ok {
			return nil, false
		}
		var r oauthStateRedis
		if json.Unmarshal([]byte(result), &r) != nil {
			return nil, false
		}
		return &oauthState{
			UserID:       r.UserID,
			CodeVerifier: r.CodeVerifier,
			Onboarding:   r.Onboarding,
			CliSessionID: r.CliSessionID,
			CreatedAt:    time.UnixMilli(r.CreatedAt),
		}, true
	}
	v, ok := h.states.LoadAndDelete(state)
	if !ok {
		return nil, false
	}
	return v.(*oauthState), true
}

func (h *oauthHandler) handleCheck(w http.ResponseWriter, r *http.Request) {
	platform := r.PathValue("platform")
	if _, ok := h.configs[platform]; !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{
			"error": platform + " OAuth is not configured on this server",
		})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func (h *oauthHandler) handleAuthorize(w http.ResponseWriter, r *http.Request) {
	platform := r.PathValue("platform")
	cfg, ok := h.configs[platform]
	if !ok {
		http.Redirect(w, r, "/destinations?error="+url.QueryEscape(platform+" OAuth is not configured on this server"), http.StatusFound)
		return
	}

	// Auth via short-lived auth_token (CLI destination flow) or query param token
	var userID string
	cliSessionID := r.URL.Query().Get("cli_session")

	if authToken := r.URL.Query().Get("auth_token"); authToken != "" {
		resolvedUserID, ok := h.mgr.cliSessions.consumeAuthToken(authToken)
		if !ok {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid or expired auth token"})
			return
		}
		userID = resolvedUserID
	} else {
		token := r.URL.Query().Get("token")
		if token == "" {
			token = extractBearerToken(r)
		}
		info, err := h.mgr.auth.authenticate(r.Context(), token)
		if err != nil || info == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "unauthorized"})
			return
		}
		userID = info.UserID
	}

	onboarding := r.URL.Query().Get("onboarding") == "true"

	// Generate PKCE code verifier + challenge (S256)
	verifierBytes := make([]byte, 32)
	if _, err := rand.Read(verifierBytes); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate code verifier"})
		return
	}
	codeVerifier := base64.RawURLEncoding.EncodeToString(verifierBytes)
	hash := sha256.Sum256([]byte(codeVerifier))
	codeChallenge := base64.RawURLEncoding.EncodeToString(hash[:])

	// Generate state
	stateBytes := make([]byte, 16)
	if _, err := rand.Read(stateBytes); err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to generate state"})
		return
	}
	state := hex.EncodeToString(stateBytes)

	h.storeState(state, &oauthState{
		UserID:       userID,
		CodeVerifier: codeVerifier,
		Onboarding:   onboarding,
		CliSessionID: cliSessionID,
		CreatedAt:    time.Now(),
	})

	redirectURI := h.redirectBase + "/oauth/" + platform + "/callback"
	params := url.Values{
		"client_id":     {cfg.ClientID},
		"redirect_uri":  {redirectURI},
		"response_type": {"code"},
		"state":         {state},
	}
	if cfg.Scopes != "" {
		params.Set("scope", cfg.Scopes)
	}
	// Restream does not support PKCE
	if platform != "restream" {
		params.Set("code_challenge", codeChallenge)
		params.Set("code_challenge_method", "S256")
	}

	// YouTube needs access_type=offline for refresh tokens
	if platform == "youtube" {
		params.Set("access_type", "offline")
		params.Set("prompt", "consent")
	}

	http.Redirect(w, r, cfg.AuthURL+"?"+params.Encode(), http.StatusFound)
}

func (h *oauthHandler) handleCallback(w http.ResponseWriter, r *http.Request) {
	platform := r.PathValue("platform")
	cfg, ok := h.configs[platform]
	if !ok {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "unsupported platform"})
		return
	}

	code := r.URL.Query().Get("code")
	state := r.URL.Query().Get("state")
	if code == "" || state == "" {
		errMsg := r.URL.Query().Get("error_description")
		if errMsg == "" {
			errMsg = r.URL.Query().Get("error")
		}
		if errMsg == "" {
			errMsg = "missing code or state"
		}
		http.Redirect(w, r, "/destinations?error="+url.QueryEscape(errMsg), http.StatusFound)
		return
	}

	// Validate state
	oauthSt, stateOk := h.loadAndDeleteState(state)
	if !stateOk {
		http.Redirect(w, r, "/destinations?error=invalid+state", http.StatusFound)
		return
	}
	if time.Since(oauthSt.CreatedAt) > 10*time.Minute {
		http.Redirect(w, r, "/destinations?error=state+expired", http.StatusFound)
		return
	}

	// Exchange code for tokens
	redirectURI := h.redirectBase + "/oauth/" + platform + "/callback"
	tokenResp, err := exchangeCode(cfg, code, redirectURI, oauthSt.CodeVerifier, platform)
	if err != nil {
		log.Printf("OAuth token exchange failed for %s: %v", platform, err)
		http.Redirect(w, r, "/destinations?error="+url.QueryEscape("token exchange failed"), http.StatusFound)
		return
	}

	// Fetch platform user info
	platformUserID, username, err := cfg.UserInfoFunc(tokenResp.AccessToken, cfg.ClientID)
	if err != nil {
		log.Printf("OAuth user info fetch failed for %s: %v", platform, err)
		errMsg := "failed to fetch user info"
		if platform == "youtube" && strings.Contains(err.Error(), "no YouTube channel") {
			errMsg = "No channel found for that YouTube account. Please log in to YouTube on that account and create a channel, then come back here and try again."
		}
		http.Redirect(w, r, "/destinations?error="+url.QueryEscape(errMsg), http.StatusFound)
		return
	}

	// Fetch stream key synchronously — required for the destination to be usable
	client, clientErr := GetPlatformClient(platform)
	var rtmpURL, streamKey string
	if clientErr == nil {
		rtmpURL, streamKey, err = client.GetStreamKey(context.Background(), tokenResp.AccessToken, platformUserID)
		if err != nil {
			log.Printf("Failed to get stream key for %s: %v", platform, err)
			errMsg := fmt.Sprintf("Failed to get stream key for %s: %v", platform, err)
			if platform == "youtube" {
				errMsg = "Your YouTube channel is not configured for live streaming. Please go to YouTube Studio, enable live streaming, and wait for it to be activated (up to 24 hours), then come back here and try again."
			}
			http.Redirect(w, r, "/destinations?error="+url.QueryEscape(errMsg), http.StatusFound)
			return
		}
	}

	// Encrypt tokens and stream key
	encAccess, err := encryptString(h.mgr.encryptionKey, tokenResp.AccessToken)
	if err != nil {
		log.Printf("Failed to encrypt access token: %v", err)
		http.Redirect(w, r, "/destinations?error=internal+error", http.StatusFound)
		return
	}
	encRefresh, err := encryptString(h.mgr.encryptionKey, tokenResp.RefreshToken)
	if err != nil {
		log.Printf("Failed to encrypt refresh token: %v", err)
		http.Redirect(w, r, "/destinations?error=internal+error", http.StatusFound)
		return
	}

	var encStreamKey string
	if streamKey != "" {
		encStreamKey, err = encryptString(h.mgr.encryptionKey, streamKey)
		if err != nil {
			log.Printf("Failed to encrypt stream key: %v", err)
			http.Redirect(w, r, "/destinations?error=internal+error", http.StatusFound)
			return
		}
	}

	var expiresAt sql.NullTime
	if tokenResp.ExpiresIn > 0 {
		expiresAt = sql.NullTime{
			Time:  time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second),
			Valid: true,
		}
	}

	// Upsert stream destination (consolidated — no separate platform_connections)
	if _, err := dbUpsertStreamDest(h.mgr.db, oauthSt.UserID, platform, platformUserID, username, rtmpURL, encStreamKey, encAccess, encRefresh, expiresAt, cfg.Scopes); err != nil {
		log.Printf("Failed to upsert stream destination: %v", err)
		http.Redirect(w, r, "/destinations?error=internal+error", http.StatusFound)
		return
	}

	log.Printf("OAuth stream destination upserted for %s/%s (user=%s)", platform, username, oauthSt.UserID)

	// CLI destination flow: set pending result and redirect to SPA verify page
	if oauthSt.CliSessionID != "" {
		cliSession := h.mgr.cliSessions.get(oauthSt.CliSessionID)
		if cliSession != nil {
			h.mgr.cliSessions.setPending(oauthSt.CliSessionID, &cliSessionResult{
				Platform:         platform,
				PlatformUsername: username,
			})

			http.Redirect(w, r, fmt.Sprintf("/auth/cli/%s?platform=%s&username=%s",
				oauthSt.CliSessionID, url.QueryEscape(platform), url.QueryEscape(username)), http.StatusFound)
			return
		}
	}

	if oauthSt.Onboarding {
		http.Redirect(w, r, "/?connected="+platform+"&onboarding=true", http.StatusFound)
	} else {
		http.Redirect(w, r, "/destinations?connected="+platform, http.StatusFound)
	}
}

// tokenResponse is the standard OAuth token response.
type tokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	ExpiresIn    int    `json:"expires_in"`
	TokenType    string `json:"token_type"`
}

func exchangeCode(cfg *oauthPlatformConfig, code, redirectURI, codeVerifier, platform string) (*tokenResponse, error) {
	data := url.Values{
		"code":         {code},
		"grant_type":   {"authorization_code"},
		"redirect_uri": {redirectURI},
	}

	// Restream uses HTTP Basic Auth and no PKCE; other platforms send credentials in body
	if platform != "restream" {
		data.Set("client_id", cfg.ClientID)
		data.Set("client_secret", cfg.ClientSecret)
		data.Set("code_verifier", codeVerifier)
	}

	req, err := http.NewRequest("POST", cfg.TokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return nil, fmt.Errorf("failed to create token request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	if platform == "restream" {
		req.SetBasicAuth(cfg.ClientID, cfg.ClientSecret)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("token request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("token endpoint returned %d", resp.StatusCode)
	}

	var tok tokenResponse
	if err := json.Unmarshal(body, &tok); err != nil {
		return nil, fmt.Errorf("failed to parse token response: %w", err)
	}

	// Restream returns camelCase fields (accessToken, refreshToken)
	if tok.AccessToken == "" {
		var alt struct {
			AccessToken  string `json:"accessToken"`
			RefreshToken string `json:"refreshToken"`
		}
		json.Unmarshal(body, &alt)
		tok.AccessToken = alt.AccessToken
		if tok.RefreshToken == "" {
			tok.RefreshToken = alt.RefreshToken
		}
	}

	return &tok, nil
}

// refreshPlatformToken checks if the token is expired and refreshes it if needed.
// Returns the decrypted access token ready for API calls.
func refreshPlatformToken(db *sql.DB, encKey []byte, dest *streamDestRow, configs map[string]*oauthPlatformConfig) (string, error) {
	accessToken, err := decryptString(encKey, dest.AccessToken)
	if err != nil {
		return "", fmt.Errorf("failed to decrypt access token: %w", err)
	}

	// Check if token is still valid (with 5min buffer)
	if dest.TokenExpiresAt.Valid && time.Until(dest.TokenExpiresAt.Time) > 5*time.Minute {
		return accessToken, nil
	}

	// Token expired or expiring soon — refresh it
	cfg, ok := configs[dest.Platform]
	if !ok {
		return accessToken, nil // no config, return what we have
	}

	refreshToken, err := decryptString(encKey, dest.RefreshToken)
	if err != nil || refreshToken == "" {
		return accessToken, nil // no refresh token, return what we have
	}

	data := url.Values{
		"grant_type":    {"refresh_token"},
		"refresh_token": {refreshToken},
	}

	// Restream uses HTTP Basic Auth; other platforms send credentials in body
	if dest.Platform != "restream" {
		data.Set("client_id", cfg.ClientID)
		data.Set("client_secret", cfg.ClientSecret)
	}

	req, err := http.NewRequest("POST", cfg.TokenURL, strings.NewReader(data.Encode()))
	if err != nil {
		return accessToken, fmt.Errorf("failed to create refresh request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	if dest.Platform == "restream" {
		req.SetBasicAuth(cfg.ClientID, cfg.ClientSecret)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return accessToken, fmt.Errorf("refresh request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return accessToken, fmt.Errorf("refresh endpoint returned %d", resp.StatusCode)
	}

	var tok tokenResponse
	if err := json.Unmarshal(body, &tok); err != nil {
		return accessToken, fmt.Errorf("failed to parse refresh response: %w", err)
	}

	// Restream returns camelCase fields (accessToken, refreshToken)
	if tok.AccessToken == "" {
		var alt struct {
			AccessToken  string `json:"accessToken"`
			RefreshToken string `json:"refreshToken"`
		}
		json.Unmarshal(body, &alt)
		tok.AccessToken = alt.AccessToken
		if tok.RefreshToken == "" {
			tok.RefreshToken = alt.RefreshToken
		}
	}

	// Update stored tokens
	newEncAccess, err := encryptString(encKey, tok.AccessToken)
	if err != nil {
		return tok.AccessToken, nil
	}

	newEncRefresh := dest.RefreshToken
	if tok.RefreshToken != "" {
		if enc, err := encryptString(encKey, tok.RefreshToken); err == nil {
			newEncRefresh = enc
		}
	}

	var expiresAt sql.NullTime
	if tok.ExpiresIn > 0 {
		expiresAt = sql.NullTime{
			Time:  time.Now().Add(time.Duration(tok.ExpiresIn) * time.Second),
			Valid: true,
		}
	}

	if err := dbUpdateStreamDestTokens(db, dest.ID, newEncAccess, newEncRefresh, expiresAt); err != nil {
		log.Printf("WARN: failed to update refreshed token for %s/%s: %v", dest.UserID, dest.Platform, err)
	}

	return tok.AccessToken, nil
}

// fetchTwitchUserInfo gets the Twitch user ID and username from the Helix API.
func fetchTwitchUserInfo(accessToken, clientID string) (string, string, error) {
	req, _ := http.NewRequest("GET", "https://api.twitch.tv/helix/users", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Client-Id", clientID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	var result struct {
		Data []struct {
			ID    string `json:"id"`
			Login string `json:"login"`
		} `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return "", "", err
	}
	if len(result.Data) == 0 {
		return "", "", fmt.Errorf("no user data returned")
	}
	return result.Data[0].ID, result.Data[0].Login, nil
}

// fetchYouTubeUserInfo gets the YouTube channel ID and title.
func fetchYouTubeUserInfo(accessToken, clientID string) (string, string, error) {
	req, _ := http.NewRequest("GET", "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		log.Printf("YouTube channels API returned %d", resp.StatusCode)
		return "", "", fmt.Errorf("YouTube API error (%d)", resp.StatusCode)
	}

	var result struct {
		Items []struct {
			ID      string `json:"id"`
			Snippet struct {
				Title string `json:"title"`
			} `json:"snippet"`
		} `json:"items"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", "", err
	}
	if len(result.Items) == 0 {
		return "", "", fmt.Errorf("no YouTube channel found for this account")
	}
	return result.Items[0].ID, result.Items[0].Snippet.Title, nil
}

// fetchKickUserInfo gets the Kick user ID and username via the channels endpoint.
func fetchKickUserInfo(accessToken, clientID string) (string, string, error) {
	// Use /public/v1/channels which returns the authenticated user's channel info
	req, _ := http.NewRequest("GET", "https://api.kick.com/public/v1/channels", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)

	// Try parsing as array first (list response), then as single object
	var listResult struct {
		Data []struct {
			BroadcasterUserID int    `json:"broadcaster_user_id"`
			Slug              string `json:"slug"`
			Username          string `json:"username"`
		} `json:"data"`
	}
	if err := json.Unmarshal(body, &listResult); err == nil && len(listResult.Data) > 0 {
		ch := listResult.Data[0]
		username := ch.Username
		if username == "" {
			username = ch.Slug
		}
		return fmt.Sprintf("%d", ch.BroadcasterUserID), username, nil
	}

	// Try single object
	var objResult struct {
		Data struct {
			BroadcasterUserID int    `json:"broadcaster_user_id"`
			Slug              string `json:"slug"`
			Username          string `json:"username"`
		} `json:"data"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(body, &objResult); err == nil && objResult.Data.BroadcasterUserID != 0 {
		username := objResult.Data.Username
		if username == "" {
			username = objResult.Data.Slug
		}
		return fmt.Sprintf("%d", objResult.Data.BroadcasterUserID), username, nil
	}

	if objResult.Message != "" {
		return "", "", fmt.Errorf("kick API error: %s", objResult.Message)
	}

	return "", "", fmt.Errorf("failed to get user info from Kick (unexpected response format)")
}

// fetchRestreamUserInfo gets the Restream user ID and display name.
func fetchRestreamUserInfo(accessToken, clientID string) (string, string, error) {
	req, _ := http.NewRequest("GET", "https://api.restream.io/v2/user/profile", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("restream user profile returned %d", resp.StatusCode)
	}

	// id may be int or string depending on the API version
	var result struct {
		ID          json.Number `json:"id"`
		DisplayName string      `json:"displayName"`
		Username    string      `json:"username"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return "", "", fmt.Errorf("failed to parse restream user profile: %w", err)
	}

	userID := result.ID.String()
	if userID == "" {
		return "", "", fmt.Errorf("no user ID returned from Restream")
	}
	displayName := result.DisplayName
	if displayName == "" {
		displayName = result.Username
	}
	return userID, displayName, nil
}
