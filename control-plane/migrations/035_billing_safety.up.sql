-- Prevent duplicate open usage events for the same stage (race protection).
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_stage_open
  ON usage_events(stage_id) WHERE ended_at IS NULL;

-- Ensure ended_at and duration_seconds are both null or both non-null.
ALTER TABLE usage_events ADD CONSTRAINT chk_usage_events_ended_duration
  CHECK ((ended_at IS NULL AND duration_seconds IS NULL) OR (ended_at IS NOT NULL AND duration_seconds IS NOT NULL));

-- Prevent grants from being over-consumed at the DB level.
ALTER TABLE usage_grants ADD CONSTRAINT chk_grants_used_within_limit
  CHECK (minutes IS NULL OR used_minutes <= minutes);

-- Prevent multiple active subscriptions per user.
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_user_active
  ON subscriptions(user_id) WHERE status = 'active';

-- usage_grants should cascade on user delete (consistent with other tables).
ALTER TABLE usage_grants DROP CONSTRAINT usage_grants_user_id_fkey;
ALTER TABLE usage_grants ADD CONSTRAINT usage_grants_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
