ALTER TABLE users DROP CONSTRAINT IF EXISTS chk_overage_limit_cents_nonneg;
ALTER TABLE usage_events ALTER COLUMN id SET DEFAULT gen_random_uuid();
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS chk_subscriptions_plan;
ALTER TABLE subscriptions ADD CONSTRAINT subscriptions_plan_check CHECK (plan IN ('free', 'starter', 'pro'));
ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS chk_subscriptions_status;
