-- Prevent duplicate open usage events for the same stage.
-- Only one event with ended_at IS NULL should exist per stage at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_usage_events_one_open_per_stage
  ON usage_events (stage_id) WHERE ended_at IS NULL;
