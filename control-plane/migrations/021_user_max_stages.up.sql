-- Per-user stage limit. Defaults to 3 (matches MAX_STAGES env var).
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS max_stages INTEGER NOT NULL DEFAULT 3;
