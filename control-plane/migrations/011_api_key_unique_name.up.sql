-- Add unique constraint on (user_id, name) for API keys.
-- Delete duplicates first, keeping only the most recent key per (user_id, name).
DELETE FROM api_keys
WHERE id NOT IN (
    SELECT DISTINCT ON (user_id, name) id
    FROM api_keys
    ORDER BY user_id, name, created_at DESC
);

ALTER TABLE api_keys ADD CONSTRAINT api_keys_user_id_name_key UNIQUE (user_id, name);
