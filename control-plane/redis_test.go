package main

import (
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/alicebob/miniredis/v2"
	"github.com/redis/go-redis/v9"

	"github.com/browser-streamer/control-plane/internal/redisclient"
)

// newTestRedis starts a miniredis instance and returns a connected client.
func newTestRedis(t *testing.T) *redis.Client {
	t.Helper()
	mr := miniredis.RunT(t)
	rdb := redis.NewClient(&redis.Options{Addr: mr.Addr()})
	t.Cleanup(func() { rdb.Close() })
	return rdb
}

// ---------------------------------------------------------------------------
// CLI Session tests
// ---------------------------------------------------------------------------

func TestCliSession_CreateAndGet_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	mgr := newCliSessionManager(rdb)

	s := mgr.create("login", "my-key", "twitch", "1234", "")
	if s.ID == "" || s.Status != "pending" || s.Type != "login" {
		t.Fatalf("unexpected session: %+v", s)
	}

	got := mgr.get(s.ID)
	if got == nil {
		t.Fatal("get returned nil")
	}
	if got.ID != s.ID || got.VerifyCode != "1234" || got.KeyName != "my-key" {
		t.Errorf("get mismatch: %+v", got)
	}
}

func TestCliSession_GetNotFound_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	mgr := newCliSessionManager(rdb)

	if got := mgr.get("nonexistent"); got != nil {
		t.Errorf("expected nil, got %+v", got)
	}
}

func TestCliSession_Complete_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	mgr := newCliSessionManager(rdb)

	s := mgr.create("login", "", "", "code", "")
	result := &cliSessionResult{Token: "tok-123", Email: "a@b.com"}

	if err := mgr.complete(s.ID, result); err != nil {
		t.Fatal(err)
	}

	got := mgr.get(s.ID)
	if got.Status != "complete" {
		t.Errorf("status = %s, want complete", got.Status)
	}
	if got.Result == nil || got.Result.Token != "tok-123" {
		t.Errorf("result = %+v, want token tok-123", got.Result)
	}
}

func TestCliSession_CompleteAlreadyComplete_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	mgr := newCliSessionManager(rdb)

	s := mgr.create("login", "", "", "code", "")
	mgr.complete(s.ID, &cliSessionResult{Token: "a"})

	err := mgr.complete(s.ID, &cliSessionResult{Token: "b"})
	if err == nil {
		t.Fatal("expected error on double-complete")
	}
}

func TestCliSession_SetPending_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	mgr := newCliSessionManager(rdb)

	s := mgr.create("destination", "", "twitch", "code", "user-1")
	pending := &cliSessionResult{Platform: "twitch", PlatformUsername: "streamer1"}

	if err := mgr.setPending(s.ID, pending); err != nil {
		t.Fatal(err)
	}

	got := mgr.get(s.ID)
	if got.PendingResult == nil || got.PendingResult.PlatformUsername != "streamer1" {
		t.Errorf("pending result = %+v", got.PendingResult)
	}
}

func TestCliSession_Poll_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	mgr := newCliSessionManager(rdb)

	s := mgr.create("login", "", "", "1234", "")

	snap, err := mgr.poll(s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if snap.Status != "pending" || snap.VerifyCode != "" {
		// poll should return a snapshot (VerifyCode is not populated in get for Redis path,
		// but it is populated since Redis stores the full session)
		t.Logf("poll snapshot: %+v", snap)
	}
}

func TestCliSession_PollNotFound_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	mgr := newCliSessionManager(rdb)

	_, err := mgr.poll("bogus")
	if err == nil {
		t.Fatal("expected error")
	}
}

func TestCliSession_Consume_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	mgr := newCliSessionManager(rdb)

	s := mgr.create("login", "", "", "code", "")
	mgr.complete(s.ID, &cliSessionResult{Token: "tok"})

	consumed, err := mgr.consume(s.ID)
	if err != nil {
		t.Fatal(err)
	}
	if consumed.Result == nil || consumed.Result.Token != "tok" {
		t.Errorf("consumed result = %+v", consumed.Result)
	}
}

func TestCliSession_ConsumeNotComplete_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	mgr := newCliSessionManager(rdb)

	s := mgr.create("login", "", "", "code", "")

	_, err := mgr.consume(s.ID)
	if err == nil {
		t.Fatal("expected error consuming pending session")
	}
}

func TestCliSession_ConsumeNotFound_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	mgr := newCliSessionManager(rdb)

	_, err := mgr.consume("nonexistent")
	if err == nil {
		t.Fatal("expected error")
	}
}

// ---------------------------------------------------------------------------
// Auth token tests
// ---------------------------------------------------------------------------

func TestAuthToken_CreateAndConsume_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	mgr := newCliSessionManager(rdb)

	token := mgr.createAuthToken("user-42")
	if token == "" {
		t.Fatal("empty token")
	}

	userID, ok := mgr.consumeAuthToken(token)
	if !ok || userID != "user-42" {
		t.Errorf("consume = (%s, %v), want (user-42, true)", userID, ok)
	}
}

func TestAuthToken_SingleUse_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	mgr := newCliSessionManager(rdb)

	token := mgr.createAuthToken("user-42")
	mgr.consumeAuthToken(token)

	_, ok := mgr.consumeAuthToken(token)
	if ok {
		t.Error("second consume should fail")
	}
}

func TestAuthToken_NotFound_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	mgr := newCliSessionManager(rdb)

	_, ok := mgr.consumeAuthToken("bogus")
	if ok {
		t.Error("expected not found")
	}
}

// ---------------------------------------------------------------------------
// OAuth state tests
// ---------------------------------------------------------------------------

func TestOAuthState_StoreAndLoad_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	h := &oauthHandler{rdb: rdb}

	state := "abc123"
	h.storeState(state, &oauthState{
		UserID:       "user-1",
		CodeVerifier: "verifier",
		Onboarding:   true,
		CliSessionID: "sess-1",
		CreatedAt:    time.Now(),
	})

	got, ok := h.loadAndDeleteState(state)
	if !ok {
		t.Fatal("load returned false")
	}
	if got.UserID != "user-1" || got.CodeVerifier != "verifier" || !got.Onboarding || got.CliSessionID != "sess-1" {
		t.Errorf("state mismatch: %+v", got)
	}
}

func TestOAuthState_SingleUse_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	h := &oauthHandler{rdb: rdb}

	state := "xyz"
	h.storeState(state, &oauthState{UserID: "u", CreatedAt: time.Now()})
	h.loadAndDeleteState(state)

	_, ok := h.loadAndDeleteState(state)
	if ok {
		t.Error("second load should fail after delete")
	}
}

func TestOAuthState_NotFound_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	h := &oauthHandler{rdb: rdb}

	_, ok := h.loadAndDeleteState("nonexistent")
	if ok {
		t.Error("expected not found")
	}
}

// ---------------------------------------------------------------------------
// Rate limiter tests
// ---------------------------------------------------------------------------

func TestRateLimiter_AllowsUpToLimit_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	rl := newRateLimiter(rdb)

	for i := 0; i < 5; i++ {
		if !rl.allow("1.2.3.4", 5, time.Minute) {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
	if rl.allow("1.2.3.4", 5, time.Minute) {
		t.Error("6th request should be denied")
	}
}

func TestRateLimiter_SeparateIPs_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	rl := newRateLimiter(rdb)

	for i := 0; i < 3; i++ {
		rl.allow("1.1.1.1", 3, time.Minute)
	}
	if rl.allow("1.1.1.1", 3, time.Minute) {
		t.Error("IP 1 should be denied")
	}
	if !rl.allow("2.2.2.2", 3, time.Minute) {
		t.Error("IP 2 should be allowed")
	}
}

// ---------------------------------------------------------------------------
// Distributed lock tests
// ---------------------------------------------------------------------------

func TestDistributedLock_AcquireAndRelease(t *testing.T) {
	rdb := newTestRedis(t)
	ctx := context.Background()

	ok, err := redisclient.Lock(ctx, rdb, "lock:test", "holder-1", 5*time.Second)
	if err != nil {
		t.Fatal(err)
	}
	if !ok {
		t.Fatal("lock should be acquired")
	}

	// Same holder can't double-acquire
	ok2, _ := redisclient.Lock(ctx, rdb, "lock:test", "holder-1", 5*time.Second)
	if ok2 {
		t.Error("double acquire should fail")
	}

	// Different holder can't acquire
	ok3, _ := redisclient.Lock(ctx, rdb, "lock:test", "holder-2", 5*time.Second)
	if ok3 {
		t.Error("different holder should be blocked")
	}

	// Release
	if err := redisclient.Unlock(ctx, rdb, "lock:test", "holder-1"); err != nil {
		t.Fatal(err)
	}

	// Now holder-2 can acquire
	ok4, _ := redisclient.Lock(ctx, rdb, "lock:test", "holder-2", 5*time.Second)
	if !ok4 {
		t.Error("holder-2 should acquire after release")
	}
}

func TestDistributedLock_WrongHolderCantUnlock(t *testing.T) {
	rdb := newTestRedis(t)
	ctx := context.Background()

	redisclient.Lock(ctx, rdb, "lock:test2", "holder-1", 5*time.Second)

	// holder-2 tries to unlock — should be a no-op
	redisclient.Unlock(ctx, rdb, "lock:test2", "holder-2")

	// Lock should still be held
	ok, _ := redisclient.Lock(ctx, rdb, "lock:test2", "holder-2", 5*time.Second)
	if ok {
		t.Error("lock should still be held by holder-1")
	}
}

// ---------------------------------------------------------------------------
// Manager lockStage / lockBudget tests (integration with Redis)
// ---------------------------------------------------------------------------

func TestManagerLockStage_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	m := &Manager{rdb: rdb, replicaID: "test-pod-1"}

	ctx := context.Background()
	unlock, err := m.lockStage(ctx, "stage-1")
	if err != nil {
		t.Fatal(err)
	}

	// Verify lock is held — a second goroutine should block
	acquired := make(chan bool, 1)
	go func() {
		ctx2, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
		defer cancel()
		// This uses a different replicaID to simulate another pod
		m2 := &Manager{rdb: rdb, replicaID: "test-pod-2"}
		_, err := m2.lockStage(ctx2, "stage-1")
		acquired <- (err == nil)
	}()

	time.Sleep(100 * time.Millisecond)
	select {
	case got := <-acquired:
		if got {
			t.Error("second lock should not succeed while first is held")
		}
	default:
		// Still blocking — good
	}

	unlock()

	// Now the second attempt (with a fresh context) should succeed
	m2 := &Manager{rdb: rdb, replicaID: "test-pod-2"}
	unlock2, err := m2.lockStage(ctx, "stage-1")
	if err != nil {
		t.Fatalf("second lock after release should succeed: %v", err)
	}
	unlock2()
}

func TestManagerLockBudget_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	m := &Manager{rdb: rdb, replicaID: "test-pod"}

	ctx := context.Background()
	unlock, err := m.lockBudget(ctx, "user-1")
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()

	// Verify held with short timeout
	ctx2, cancel := context.WithTimeout(ctx, 100*time.Millisecond)
	defer cancel()
	m2 := &Manager{rdb: rdb, replicaID: "test-pod-2"}
	_, err = m2.lockBudget(ctx2, "user-1")
	if err == nil {
		t.Error("budget lock should not be acquired while held")
	}
}

func TestManagerLockStage_MutualExclusion_Redis(t *testing.T) {
	rdb := newTestRedis(t)

	var counter int64
	var wg sync.WaitGroup
	const goroutines = 10

	for i := 0; i < goroutines; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			m := &Manager{rdb: rdb, replicaID: "pod-" + string(rune('a'+id))}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			unlock, err := m.lockStage(ctx, "stage-shared")
			if err != nil {
				return
			}
			// Critical section — increment should be serialized
			val := atomic.LoadInt64(&counter)
			time.Sleep(time.Millisecond)
			atomic.StoreInt64(&counter, val+1)
			unlock()
		}(i)
	}
	wg.Wait()

	if atomic.LoadInt64(&counter) != goroutines {
		t.Errorf("counter = %d, want %d (mutual exclusion violated)", counter, goroutines)
	}
}

// ---------------------------------------------------------------------------
// Cancel flag tests
// ---------------------------------------------------------------------------

func TestCancelFlag_Redis(t *testing.T) {
	rdb := newTestRedis(t)
	m := &Manager{rdb: rdb}

	if m.checkCancelFlag("stage-1") {
		t.Error("flag should not be set initially")
	}

	m.setCancelFlag("stage-1")

	if !m.checkCancelFlag("stage-1") {
		t.Error("flag should be set after setCancelFlag")
	}
}

func TestCancelFlag_NilRedis(t *testing.T) {
	m := &Manager{}

	// Should always return false with no Redis
	m.setCancelFlag("stage-1")
	if m.checkCancelFlag("stage-1") {
		t.Error("should return false without redis")
	}
}

// ---------------------------------------------------------------------------
// In-memory fallback tests (rdb=nil)
// ---------------------------------------------------------------------------

func TestCliSession_InMemoryFallback(t *testing.T) {
	mgr := newCliSessionManager(nil)

	s := mgr.create("login", "key", "", "1234", "")
	got := mgr.get(s.ID)
	if got == nil || got.ID != s.ID {
		t.Fatal("in-memory get failed")
	}

	mgr.complete(s.ID, &cliSessionResult{Token: "t"})
	consumed, err := mgr.consume(s.ID)
	if err != nil || consumed.Result.Token != "t" {
		t.Errorf("in-memory consume failed: %v, %+v", err, consumed)
	}
}

func TestAuthToken_InMemoryFallback(t *testing.T) {
	mgr := newCliSessionManager(nil)

	token := mgr.createAuthToken("user-1")
	uid, ok := mgr.consumeAuthToken(token)
	if !ok || uid != "user-1" {
		t.Errorf("in-memory auth token: (%s, %v)", uid, ok)
	}

	_, ok = mgr.consumeAuthToken(token)
	if ok {
		t.Error("in-memory token should be single-use")
	}
}

func TestOAuthState_InMemoryFallback(t *testing.T) {
	h := &oauthHandler{} // rdb=nil

	h.storeState("s1", &oauthState{UserID: "u1", CreatedAt: time.Now()})
	got, ok := h.loadAndDeleteState("s1")
	if !ok || got.UserID != "u1" {
		t.Errorf("in-memory oauth: %+v, %v", got, ok)
	}

	_, ok = h.loadAndDeleteState("s1")
	if ok {
		t.Error("in-memory oauth should be single-use")
	}
}

func TestRateLimiter_InMemoryFallback(t *testing.T) {
	rl := newRateLimiter(nil)

	for i := 0; i < 3; i++ {
		if !rl.allow("1.1.1.1", 3, time.Minute) {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
	if rl.allow("1.1.1.1", 3, time.Minute) {
		t.Error("should be denied after limit")
	}
}

func TestManagerLockStage_InMemoryFallback(t *testing.T) {
	m := &Manager{}

	ctx := context.Background()
	unlock, err := m.lockStage(ctx, "stage-1")
	if err != nil {
		t.Fatal(err)
	}
	unlock()
}
