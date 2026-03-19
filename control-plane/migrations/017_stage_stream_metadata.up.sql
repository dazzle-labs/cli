-- Stream metadata columns for OG tags on public watch pages.
ALTER TABLE stages
  ADD COLUMN IF NOT EXISTS stream_title TEXT,
  ADD COLUMN IF NOT EXISTS stream_category TEXT;
