CREATE TABLE IF NOT EXISTS usage_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage_id UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('cpu', 'gpu')),
  started_at TIMESTAMPTZ NOT NULL,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER,
  reported_to_stripe BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_events_user_period ON usage_events(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_usage_events_unreported
  ON usage_events(reported_to_stripe) WHERE reported_to_stripe = FALSE AND ended_at IS NOT NULL;
