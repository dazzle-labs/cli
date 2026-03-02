ALTER TABLE session_log ALTER COLUMN direct_port SET DEFAULT 0;
ALTER TABLE session_log ALTER COLUMN direct_port DROP NOT NULL;
