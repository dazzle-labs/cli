ALTER TABLE usage_events DROP CONSTRAINT IF EXISTS chk_usage_events_ended_duration;
ALTER TABLE usage_grants DROP CONSTRAINT IF EXISTS chk_grants_used_within_limit;
DROP INDEX IF EXISTS idx_subscriptions_user_active;
ALTER TABLE usage_grants DROP CONSTRAINT IF EXISTS usage_grants_user_id_fkey;
ALTER TABLE usage_grants ADD CONSTRAINT usage_grants_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id);
