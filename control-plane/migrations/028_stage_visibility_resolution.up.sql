ALTER TABLE stages
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private')),
  ADD COLUMN IF NOT EXISTS resolution TEXT NOT NULL DEFAULT '720p'
    CHECK (resolution IN ('720p', '1080p'));
