ALTER TABLE users
  DROP COLUMN IF EXISTS overage_enabled,
  DROP COLUMN IF EXISTS overage_limit_cents;
