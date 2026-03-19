DROP TABLE IF EXISTS rtmp_sessions;
DROP INDEX IF EXISTS idx_stages_stream_key;
DROP INDEX IF EXISTS idx_stages_slug;
ALTER TABLE stages
  DROP COLUMN IF EXISTS stream_key,
  DROP COLUMN IF EXISTS slug;
