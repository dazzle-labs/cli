-- WARNING: This migration permanently destroys all usage/billing event history.
-- Do NOT run in production without a verified backup of the usage_events table.
DROP TABLE IF EXISTS usage_events;
