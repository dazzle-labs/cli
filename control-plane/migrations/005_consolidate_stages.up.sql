-- Rename endpoints to stages, add pod-tracking columns
ALTER TABLE endpoints RENAME TO stages;
ALTER TABLE stages ADD COLUMN status TEXT NOT NULL DEFAULT 'inactive';
ALTER TABLE stages ADD COLUMN pod_name TEXT;
ALTER TABLE stages ADD COLUMN pod_ip TEXT;
ALTER TABLE stages ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Drop stage_log (history now tracked via status on stages table)
DROP TABLE IF EXISTS stage_log;
