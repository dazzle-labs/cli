-- Add per-stage destination selection
ALTER TABLE stages ADD COLUMN destination_id TEXT REFERENCES stream_destinations(id) ON DELETE SET NULL;

-- Backfill: assign each stage its user's first destination (by created_at)
UPDATE stages SET destination_id = (
    SELECT id FROM stream_destinations
    WHERE user_id = stages.user_id
    ORDER BY created_at
    LIMIT 1
) WHERE destination_id IS NULL;
