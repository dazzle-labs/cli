ALTER TABLE stages ADD COLUMN preview_token TEXT;
UPDATE stages SET preview_token = 'dpt_' || replace(gen_random_uuid()::text, '-', '') WHERE preview_token IS NULL;
