DROP TABLE IF EXISTS platform_connections;

ALTER TABLE stream_destinations
  ADD COLUMN IF NOT EXISTS platform_user_id TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS platform_username TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS access_token TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS refresh_token TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS scopes TEXT NOT NULL DEFAULT '';

CREATE UNIQUE INDEX IF NOT EXISTS uq_stream_dest_user_platform_username
  ON stream_destinations(user_id, platform, platform_username);
