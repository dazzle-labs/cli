package redisclient

import (
	"context"
	"time"

	"github.com/redis/go-redis/v9"
)

// Lock acquires a distributed lock using SET NX EX.
// Returns true if the lock was acquired, false if already held.
func Lock(ctx context.Context, rdb *redis.Client, key, holder string, ttl time.Duration) (bool, error) {
	ok, err := rdb.SetNX(ctx, key, holder, ttl).Result()
	if err != nil {
		return false, err
	}
	return ok, nil
}

// renewScript atomically extends the TTL only if the caller is still the holder.
var renewScript = redis.NewScript(`
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("PEXPIRE", KEYS[1], ARGV[2])
end
return 0
`)

// Renew extends the lock TTL if the caller is still the holder.
// Returns true if the renewal succeeded, false if the lock was lost.
func Renew(ctx context.Context, rdb *redis.Client, key, holder string, ttl time.Duration) (bool, error) {
	result, err := renewScript.Run(ctx, rdb, []string{key}, holder, ttl.Milliseconds()).Int()
	if err != nil {
		return false, err
	}
	return result == 1, nil
}

// LockWithRenewal acquires the lock and starts a background goroutine that
// renews the TTL at half the interval until the returned cancel function is called.
// This prevents the lock from expiring while the holder is still working.
// The caller MUST call the returned cancel function (which also unlocks).
func LockWithRenewal(ctx context.Context, rdb *redis.Client, key, holder string, ttl time.Duration) (ok bool, cancel func(), err error) {
	ok, err = Lock(ctx, rdb, key, holder, ttl)
	if err != nil || !ok {
		return ok, nil, err
	}

	renewCtx, renewCancel := context.WithCancel(context.Background())
	go func() {
		ticker := time.NewTicker(ttl / 2)
		defer ticker.Stop()
		for {
			select {
			case <-renewCtx.Done():
				return
			case <-ticker.C:
				renewed, err := Renew(renewCtx, rdb, key, holder, ttl)
				if err != nil || !renewed {
					return // lock lost or error — stop renewing
				}
			}
		}
	}()

	cancel = func() {
		renewCancel()
		unlockCtx, unlockCancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer unlockCancel()
		Unlock(unlockCtx, rdb, key, holder)
	}
	return true, cancel, nil
}

// unlockScript atomically checks the holder before deleting.
var unlockScript = redis.NewScript(`
if redis.call("GET", KEYS[1]) == ARGV[1] then
	return redis.call("DEL", KEYS[1])
end
return 0
`)

// Unlock releases a distributed lock only if the caller is the holder.
func Unlock(ctx context.Context, rdb *redis.Client, key, holder string) error {
	_, err := unlockScript.Run(ctx, rdb, []string{key}, holder).Result()
	return err
}
