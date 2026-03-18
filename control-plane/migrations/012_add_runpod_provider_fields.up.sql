ALTER TABLE stages ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'kubernetes';
ALTER TABLE stages ADD COLUMN IF NOT EXISTS runpod_pod_id text;
ALTER TABLE stages ADD COLUMN IF NOT EXISTS sidecar_url text;
