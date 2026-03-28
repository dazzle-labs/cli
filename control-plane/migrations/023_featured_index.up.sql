-- Change featured from boolean to integer index (higher = more prominent).
-- Existing featured=true rows get index 1, non-featured get 0.
ALTER TABLE stages ADD COLUMN featured_index INTEGER NOT NULL DEFAULT 0;
UPDATE stages SET featured_index = 1 WHERE featured = true;
ALTER TABLE stages DROP COLUMN featured;
