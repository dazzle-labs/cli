package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
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
	rdb        *redis.Client
	sessions   sync.Map // id -> *cliSession (in-memory fallback)
	authTokens sync.Map // token -> *authTokenEntry (in-memory fallback)
}

type authTokenEntry struct {
	UserID    string
	CreatedAt time.Time
}

const (
	redisSessionPrefix   = "cli:session:"
	redisAuthTokenPrefix = "cli:auth:"
	sessionTTL           = 10 * time.Minute
	consumeGraceTTL      = 30 * time.Second
)

func newCliSessionManager(rdb *redis.Client) *cliSessionManager {
	m := &cliSessionManager{rdb: rdb}

	// In-memory cleanup only needed when Redis is not available.
	if rdb == nil {
		go func() {
			for {
				time.Sleep(30 * time.Second)
				now := time.Now()
				m.sessions.Range(func(key, value any) bool {
					s, ok := value.(*cliSession)
					if !ok {
						return true
					}
					if now.Sub(s.CreatedAt) > 10*time.Minute {
						m.sessions.Delete(key)
					}
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
	}

	return m
}

// cliSessionRedis is the JSON-serializable form stored in Redis.
type cliSessionRedis struct {
	ID            string            `json:"id"`
	Type          string            `json:"type"`
	KeyName       string            `json:"key_name"`
	Platform      string            `json:"platform"`
	VerifyCode    string            `json:"verify_code"`
	UserID        string            `json:"user_id"`
	Status        string            `json:"status"`
	PendingResult *cliSessionResult `json:"pending_result,omitempty"`
	Result        *cliSessionResult `json:"result,omitempty"`
	CreatedAt     int64             `json:"created_at"`
	ConsumedAt    int64             `json:"consumed_at,omitempty"`
}

func sessionToRedis(s *cliSession) *cliSessionRedis {
	r := &cliSessionRedis{
		ID:            s.ID,
		Type:          s.Type,
		KeyName:       s.KeyName,
		Platform:      s.Platform,
		VerifyCode:    s.VerifyCode,
		UserID:        s.UserID,
		Status:        s.Status,
		PendingResult: s.PendingResult,
		Result:        s.Result,
		CreatedAt:     s.CreatedAt.UnixMilli(),
	}
	if !s.ConsumedAt.IsZero() {
		r.ConsumedAt = s.ConsumedAt.UnixMilli()
	}
	return r
}

func sessionFromRedis(r *cliSessionRedis) *cliSession {
	s := &cliSession{
		ID:            r.ID,
		Type:          r.Type,
		KeyName:       r.KeyName,
		Platform:      r.Platform,
		VerifyCode:    r.VerifyCode,
		UserID:        r.UserID,
		Status:        r.Status,
		PendingResult: r.PendingResult,
		Result:        r.Result,
		CreatedAt:     time.UnixMilli(r.CreatedAt),
	}
	if r.ConsumedAt != 0 {
		s.ConsumedAt = time.UnixMilli(r.ConsumedAt)
	}
	return s
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

	if m.rdb != nil {
		data, _ := json.Marshal(sessionToRedis(s))
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		m.rdb.Set(ctx, redisSessionPrefix+id, data, sessionTTL)
	} else {
		m.sessions.Store(id, s)
	}
	return s
}

func (m *cliSessionManager) get(id string) *cliSession {
	if m.rdb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		data, err := m.rdb.Get(ctx, redisSessionPrefix+id).Bytes()
		if err != nil {
			return nil
		}
		var r cliSessionRedis
		if json.Unmarshal(data, &r) != nil {
			return nil
		}
		return sessionFromRedis(&r)
	}
	v, ok := m.sessions.Load(id)
	if !ok {
		return nil
	}
	return v.(*cliSession)
}

// redisUpdateSession is a Lua script that atomically reads, applies a Go-provided
// update, and writes back. We use it for complete, setPending, and consume.
var redisCompleteSession = redis.NewScript(`
local data = redis.call("GET", KEYS[1])
if not data then return redis.error_reply("session not found") end
local s = cjson.decode(data)
if s.status == "complete" then return redis.error_reply("session already complete") end
s.status = "complete"
s.result = cjson.decode(ARGV[1])
redis.call("SET", KEYS[1], cjson.encode(s), "KEEPTTL")
return "OK"
`)

func (m *cliSessionManager) complete(id string, result *cliSessionResult) error {
	if m.rdb != nil {
		resultJSON, _ := json.Marshal(result)
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, err := redisCompleteSession.Run(ctx, m.rdb, []string{redisSessionPrefix + id}, string(resultJSON)).Result()
		if err != nil {
			return fmt.Errorf("%v", err)
		}
		return nil
	}
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

var redisSetPending = redis.NewScript(`
local data = redis.call("GET", KEYS[1])
if not data then return redis.error_reply("session not found") end
local s = cjson.decode(data)
s.pending_result = cjson.decode(ARGV[1])
redis.call("SET", KEYS[1], cjson.encode(s), "KEEPTTL")
return "OK"
`)

func (m *cliSessionManager) setPending(id string, result *cliSessionResult) error {
	if m.rdb != nil {
		resultJSON, _ := json.Marshal(result)
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		_, err := redisSetPending.Run(ctx, m.rdb, []string{redisSessionPrefix + id}, string(resultJSON)).Result()
		if err != nil {
			return fmt.Errorf("%v", err)
		}
		return nil
	}
	s := m.get(id)
	if s == nil {
		return fmt.Errorf("session not found")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.PendingResult = result
	return nil
}

func (m *cliSessionManager) poll(id string) (*cliSession, error) {
	s := m.get(id)
	if s == nil {
		return nil, fmt.Errorf("session not found")
	}
	// For Redis path, get() already returns a copy (no shared mutex needed).
	if m.rdb != nil {
		if time.Since(s.CreatedAt) > 10*time.Minute && s.Status == "pending" {
			s.Status = "expired"
		}
		return s, nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
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

var redisConsumeSession = redis.NewScript(`
local data = redis.call("GET", KEYS[1])
if not data then return redis.error_reply("session not found") end
local s = cjson.decode(data)
if s.status ~= "complete" then return redis.error_reply("session not complete") end
s.consumed_at = tonumber(ARGV[1])
redis.call("SET", KEYS[1], cjson.encode(s), "PX", ARGV[2])
return data
`)

func (m *cliSessionManager) consume(id string) (*cliSession, error) {
	if m.rdb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		nowMs := fmt.Sprintf("%d", time.Now().UnixMilli())
		graceMs := fmt.Sprintf("%d", consumeGraceTTL.Milliseconds())
		raw, err := redisConsumeSession.Run(ctx, m.rdb, []string{redisSessionPrefix + id}, nowMs, graceMs).Result()
		if err != nil {
			return nil, fmt.Errorf("%v", err)
		}
		result, ok := raw.(string)
		if !ok {
			return nil, fmt.Errorf("unexpected redis result type")
		}
		var r cliSessionRedis
		if json.Unmarshal([]byte(result), &r) != nil {
			return nil, fmt.Errorf("corrupt session data")
		}
		return sessionFromRedis(&r), nil
	}
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

func (m *cliSessionManager) createAuthToken(userID string) string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	token := hex.EncodeToString(b)

	if m.rdb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		m.rdb.Set(ctx, redisAuthTokenPrefix+token, userID, sessionTTL)
	} else {
		m.authTokens.Store(token, &authTokenEntry{
			UserID:    userID,
			CreatedAt: time.Now(),
		})
	}
	return token
}

var redisConsumeAuthToken = redis.NewScript(`
local v = redis.call("GET", KEYS[1])
if not v then return nil end
redis.call("DEL", KEYS[1])
return v
`)

func (m *cliSessionManager) consumeAuthToken(token string) (string, bool) {
	if m.rdb != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		result, err := redisConsumeAuthToken.Run(ctx, m.rdb, []string{redisAuthTokenPrefix + token}).Result()
		if err != nil {
			return "", false
		}
		userID, ok := result.(string)
		return userID, ok && userID != ""
	}
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
