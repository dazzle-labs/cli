ALTER TABLE stages ADD COLUMN featured BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE stages SET featured = true WHERE featured_index > 0;
ALTER TABLE stages DROP COLUMN featured_index;
