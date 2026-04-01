-- Add CHECK constraint on subscriptions.status
ALTER TABLE subscriptions ADD CONSTRAINT chk_subscriptions_status
  CHECK (status IN ('active', 'canceled', 'past_due'));

-- Tighten subscriptions.plan CHECK — free users should never have a subscription row
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_plan_check;
ALTER TABLE subscriptions ADD CONSTRAINT chk_subscriptions_plan
  CHECK (plan IN ('starter', 'pro'));

-- Remove gen_random_uuid() default from usage_events — Go always provides UUIDv7
ALTER TABLE usage_events ALTER COLUMN id DROP DEFAULT;

-- Prevent negative overage limits
ALTER TABLE users ADD CONSTRAINT chk_overage_limit_cents_nonneg
  CHECK (overage_limit_cents IS NULL OR overage_limit_cents >= 0);
