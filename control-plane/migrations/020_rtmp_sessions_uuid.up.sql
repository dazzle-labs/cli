-- Convert rtmp_sessions columns from TEXT to UUID for proper joins.
-- Must drop the text default before changing the column type.
ALTER TABLE rtmp_sessions
  ALTER COLUMN id DROP DEFAULT;

ALTER TABLE rtmp_sessions
  ALTER COLUMN id        TYPE UUID USING id::uuid,
  ALTER COLUMN stage_id  TYPE UUID USING stage_id::uuid;

ALTER TABLE rtmp_sessions
  ALTER COLUMN id SET DEFAULT gen_random_uuid();
