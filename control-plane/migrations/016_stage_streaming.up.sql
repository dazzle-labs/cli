-- Per-stage stream key for RTMP routing.
-- Auto-generated on stage creation, used as the RTMP stream name.
ALTER TABLE stages
  ADD COLUMN IF NOT EXISTS stream_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stages_stream_key
  ON stages(stream_key) WHERE stream_key IS NOT NULL;

-- Short slug for public watch URLs (e.g., /watch/a1b2c3d4e5f6).
-- Derived from the last 12 hex chars of the stage's UUIDv7 ID.
ALTER TABLE stages
  ADD COLUMN IF NOT EXISTS slug TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stages_slug
  ON stages(slug) WHERE slug IS NOT NULL;

-- Backfill slugs for existing stages from their IDs.
UPDATE stages SET slug = right(replace(id::text, '-', ''), 12)
  WHERE slug IS NULL;

-- Tracks active and historical RTMP publisher sessions.
-- pod_ip records which ingest pod is serving the stream so the HLS
-- proxy can route directly to the right pod in a multi-replica setup.
CREATE TABLE IF NOT EXISTS rtmp_sessions (
    id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
    stage_id    TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    stream_key  TEXT NOT NULL,
    client_ip   TEXT NOT NULL DEFAULT '',
    pod_ip      TEXT NOT NULL DEFAULT '',
    started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rtmp_sessions_active
  ON rtmp_sessions(stage_id) WHERE ended_at IS NULL;
