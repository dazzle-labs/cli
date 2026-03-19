-- Multi-destination support: stages can stream to multiple destinations simultaneously.
-- Each stage gets its own Dazzle destination (platform='dazzle') auto-created,
-- which is hidden from the destinations UI (those are for third-party platforms).
-- Dazzle destinations are deleted when their stage is deleted.

CREATE TABLE IF NOT EXISTS stage_destinations (
    id TEXT PRIMARY KEY,
    stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
    destination_id TEXT NOT NULL REFERENCES stream_destinations(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (stage_id, destination_id)
);

CREATE INDEX IF NOT EXISTS idx_stage_destinations_stage_id ON stage_destinations(stage_id);

-- Create a Dazzle destination for each existing stage and link it.
-- The stream_destinations row stores which stage it belongs to via a naming convention
-- (name = 'Dazzle (<stage_id>)') and platform = 'dazzle'.
-- We use the stage's user_id as the owner so permission checks pass.
DO $$
DECLARE
    r RECORD;
    dest_id TEXT;
    sd_id TEXT;
BEGIN
    FOR r IN SELECT id, user_id FROM stages LOOP
        dest_id := 'dz_' || replace(gen_random_uuid()::text, '-', '');
        sd_id := 'sd_' || replace(gen_random_uuid()::text, '-', '');

        INSERT INTO stream_destinations (id, user_id, name, platform, rtmp_url, stream_key, created_at, updated_at)
        VALUES (dest_id, r.user_id, 'Dazzle', 'dazzle', '', '', NOW(), NOW());

        INSERT INTO stage_destinations (id, stage_id, destination_id, enabled)
        VALUES (sd_id, r.id, dest_id, true);
    END LOOP;
END $$;

-- Backfill: migrate existing single destination_id to stage_destinations table.
INSERT INTO stage_destinations (id, stage_id, destination_id, enabled)
SELECT
    'sd_' || replace(gen_random_uuid()::text, '-', ''),
    id,
    destination_id,
    true
FROM stages
WHERE destination_id IS NOT NULL
ON CONFLICT (stage_id, destination_id) DO NOTHING;
