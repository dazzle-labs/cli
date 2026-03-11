package main

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"sync"
	"time"
)

type cliSessionResult struct {
	Token            string `json:"token,omitempty"`
	Email            string `json:"email,omitempty"`
	KeyName          string `json:"key_name,omitempty"`
	Platform         string `json:"platform,omitempty"`
	PlatformUsername string `json:"platform_username,omitempty"`
}

type cliSession struct {
	ID            string
	Type          string // "login" or "destination"
	KeyName       string
	Platform      string
	VerifyCode    string
	UserID        string // owner — set for destination sessions (authenticated), empty for login
	Status        string // "pending", "complete", "expired"
	PendingResult *cliSessionResult
	Result        *cliSessionResult
	CreatedAt     time.Time
	ConsumedAt    time.Time // when the session was consumed — grace period before deletion
	mu            sync.Mutex
}

type cliSessionManager struct {
	sessions   sync.Map // id -> *cliSession
	authTokens sync.Map // token -> *authTokenEntry
}

type authTokenEntry struct {
	UserID    string
	CreatedAt time.Time
}

func newCliSessionManager() *cliSessionManager {
	m := &cliSessionManager{}

	// Cleanup expired sessions every 30 seconds
	go func() {
		for {
			time.Sleep(30 * time.Second)
			now := time.Now()
			m.sessions.Range(func(key, value any) bool {
				s, ok := value.(*cliSession)
				if !ok {
					return true
				}
				// Delete expired sessions
				if now.Sub(s.CreatedAt) > 10*time.Minute {
					m.sessions.Delete(key)
				}
				// Delete consumed sessions after 30s grace period (allows CLI retries)
				if !s.ConsumedAt.IsZero() && now.Sub(s.ConsumedAt) > 30*time.Second {
					m.sessions.Delete(key)
				}
				return true
			})
			m.authTokens.Range(func(key, value any) bool {
				if e, ok := value.(*authTokenEntry); ok && now.Sub(e.CreatedAt) > 10*time.Minute {
					m.authTokens.Delete(key)
				}
				return true
			})
		}
	}()

	return m
}

func (m *cliSessionManager) create(sessionType, keyName, platform, verifyCode, userID string) *cliSession {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	id := hex.EncodeToString(b)

	s := &cliSession{
		ID:         id,
		Type:       sessionType,
		KeyName:    keyName,
		Platform:   platform,
		VerifyCode: verifyCode,
		UserID:     userID,
		Status:     "pending",
		CreatedAt:  time.Now(),
	}
	m.sessions.Store(id, s)
	return s
}

func (m *cliSessionManager) get(id string) *cliSession {
	v, ok := m.sessions.Load(id)
	if !ok {
		return nil
	}
	return v.(*cliSession)
}

func (m *cliSessionManager) complete(id string, result *cliSessionResult) error {
	s := m.get(id)
	if s == nil {
		return fmt.Errorf("session not found")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Status == "complete" {
		return fmt.Errorf("session already complete")
	}
	s.Status = "complete"
	s.Result = result
	return nil
}

func (m *cliSessionManager) setPending(id string, result *cliSessionResult) error {
	s := m.get(id)
	if s == nil {
		return fmt.Errorf("session not found")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.PendingResult = result
	return nil
}

// poll returns a snapshot of session state. Does NOT consume.
func (m *cliSessionManager) poll(id string) (*cliSession, error) {
	s := m.get(id)
	if s == nil {
		return nil, fmt.Errorf("session not found")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	// Return a snapshot
	snap := &cliSession{
		ID:        s.ID,
		Type:      s.Type,
		KeyName:   s.KeyName,
		Platform:  s.Platform,
		Status:    s.Status,
		Result:    s.Result,
		CreatedAt: s.CreatedAt,
	}
	if time.Since(s.CreatedAt) > 10*time.Minute && s.Status == "pending" {
		snap.Status = "expired"
	}
	return snap, nil
}

// consume marks a complete session as consumed and returns its result.
// The session stays in the map briefly so retries work, then cleanup deletes it.
func (m *cliSessionManager) consume(id string) (*cliSession, error) {
	s := m.get(id)
	if s == nil {
		return nil, fmt.Errorf("session not found")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.Status != "complete" {
		return nil, fmt.Errorf("session not complete")
	}
	s.ConsumedAt = time.Now()
	return s, nil
}

// createAuthToken generates a short-lived, single-use token that maps to a user ID.
func (m *cliSessionManager) createAuthToken(userID string) string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	token := hex.EncodeToString(b)
	m.authTokens.Store(token, &authTokenEntry{
		UserID:    userID,
		CreatedAt: time.Now(),
	})
	return token
}

// consumeAuthToken returns the user ID for a token and deletes it (single-use).
func (m *cliSessionManager) consumeAuthToken(token string) (string, bool) {
	v, loaded := m.authTokens.LoadAndDelete(token)
	if !loaded {
		return "", false
	}
	entry := v.(*authTokenEntry)
	if time.Since(entry.CreatedAt) > 10*time.Minute {
		return "", false
	}
	return entry.UserID, true
}
