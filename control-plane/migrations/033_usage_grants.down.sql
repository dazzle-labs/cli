-- WARNING: This migration permanently destroys all usage grant data (free tier budgets,
-- metered grants, signup grants). Do NOT run in production without a verified backup.
DROP TABLE IF EXISTS usage_grants;
