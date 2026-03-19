-- Multi-destination support: stages can stream to multiple destinations simultaneously.
-- Each stage gets its own Dazzle destination (platform='dazzle') auto-created,
-- which is hidden from the destinations UI (those are for third-party platforms).
-- Dazzle destinations are deleted when their stage is deleted.

-- UUIDv7 generator: millisecond timestamp in bits 0-47, version 7 in bits 48-51,
-- random fill for the rest. Time-ordered for index locality.
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
    ms bigint;
    bytes bytea;
BEGIN
    ms := extract(epoch FROM clock_timestamp()) * 1000;
    -- 6 bytes timestamp + 10 random bytes from a v4 UUID (no pgcrypto needed)
    bytes := decode(lpad(to_hex(ms), 12, '0'), 'hex')
          || substring(decode(replace(gen_random_uuid()::text, '-', ''), 'hex') from 1 for 10);
    -- Set version 7 (bits 48-51)
    bytes := set_byte(bytes, 6, (get_byte(bytes, 6) & x'0f'::int) | x'70'::int);
    -- Set variant 2 (bits 64-65)
    bytes := set_byte(bytes, 8, (get_byte(bytes, 8) & x'3f'::int) | x'80'::int);
    RETURN encode(bytes, 'hex')::uuid;
END
$$ LANGUAGE plpgsql VOLATILE;

-- Migrate stream_destinations.id and stages.destination_id from TEXT to UUID.
-- Existing values are gen_random_uuid()::text so the cast is safe.
ALTER TABLE stages DROP CONSTRAINT IF EXISTS stages_destination_id_fkey;
ALTER TABLE stream_destinations ALTER COLUMN id DROP DEFAULT;
ALTER TABLE stream_destinations ALTER COLUMN id TYPE UUID USING id::uuid;
ALTER TABLE stream_destinations ALTER COLUMN id SET DEFAULT uuidv7();
ALTER TABLE stages ALTER COLUMN destination_id TYPE UUID USING destination_id::uuid;
ALTER TABLE stages ADD CONSTRAINT stages_destination_id_fkey
    FOREIGN KEY (destination_id) REFERENCES stream_destinations(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS stage_destinations (
    id UUID PRIMARY KEY DEFAULT uuidv7(),
    stage_id UUID NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
    destination_id UUID NOT NULL REFERENCES stream_destinations(id) ON DELETE CASCADE,
    enabled BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (stage_id, destination_id)
);

CREATE INDEX IF NOT EXISTS idx_stage_destinations_stage_id ON stage_destinations(stage_id);

-- Create a Dazzle destination for each existing stage and link it.
DO $$
DECLARE
    r RECORD;
    dest_id UUID;
BEGIN
    FOR r IN SELECT id, user_id FROM stages LOOP
        dest_id := uuidv7();

        INSERT INTO stream_destinations (id, user_id, name, platform, platform_username, rtmp_url, stream_key, created_at, updated_at)
        VALUES (dest_id, r.user_id, 'Dazzle', 'dazzle', r.slug, '', '', NOW(), NOW());

        INSERT INTO stage_destinations (stage_id, destination_id, enabled)
        VALUES (r.id, dest_id, true);
    END LOOP;
END $$;

-- Backfill: migrate existing single destination_id to stage_destinations table.
INSERT INTO stage_destinations (stage_id, destination_id, enabled)
SELECT id, destination_id, true
FROM stages
WHERE destination_id IS NOT NULL
ON CONFLICT (stage_id, destination_id) DO NOTHING;
