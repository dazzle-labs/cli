CREATE TABLE IF NOT EXISTS usage_grants (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL REFERENCES users(id),
    resource        TEXT NOT NULL,                    -- 'cpu' or 'gpu'
    minutes         INTEGER,                          -- NULL = unlimited (metered/PAYG)
    used_minutes    INTEGER NOT NULL DEFAULT 0,
    rate_cents_per_hr INTEGER NOT NULL DEFAULT 0,     -- 0 = free, >0 = billed per hour
    reason          TEXT NOT NULL,                     -- 'signup', 'monthly', 'promo', 'metered'
    expires_at      TIMESTAMPTZ,                      -- NULL = never expires
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_usage_grants_user_resource ON usage_grants(user_id, resource);
