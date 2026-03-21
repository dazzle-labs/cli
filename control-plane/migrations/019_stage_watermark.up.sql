-- Per-stage watermark toggle. When true (default), external RTMP destinations
-- get the dazzle.fm watermark overlay. Set to false for paid stages.
ALTER TABLE stages
  ADD COLUMN IF NOT EXISTS watermarked BOOLEAN NOT NULL DEFAULT TRUE;
