-- WARNING: This migration drops plan and Stripe ID columns, severing the link between
-- users and their Stripe subscriptions. Do NOT run in production without a verified backup.
DROP INDEX IF EXISTS idx_users_stripe_customer_id;
ALTER TABLE users
  DROP COLUMN IF EXISTS plan,
  DROP COLUMN IF EXISTS stripe_customer_id,
  DROP COLUMN IF EXISTS stripe_subscription_id;
