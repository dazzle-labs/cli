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
