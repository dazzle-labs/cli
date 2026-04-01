---
name: billing-test-patterns
description: >-
  Testing patterns for billing and usage calculation code in Go.
  Use when writing tests for time-dependent billing logic, Stripe
  subscription handling, overage calculations, or plan transitions.
allowed-tools: Read, Grep, Glob
---

## Principles

1. **Extract pure functions with explicit `now` parameter.** Any function calling `time.Now()` gets a `FooAt(args, now time.Time)` variant. Production wrapper calls `FooAt(args, time.Now())`. Tests call `FooAt` directly with deterministic times. See `billingPeriodFromAnchorAt()` in `billing.go`.

2. **Organize subcases by data shape, not narrative.** Table-driven tests should vary the input shape: nil items, single item, multiple items, overage-only items, zero values, negative values. Not "happy path, sad path, edge case."

3. **Cover the boundaries that actually bite.** For date clamping: anchor on 31st + February. For overage: exactly at limit, one cent over, zero included hours. For subscriptions: unexpanded objects, nil Price fields, missing items array.

4. **Delete low-value tests aggressively.** Tests that verify struct initialization, nil-only cases, or conditions you can't construct with real data are noise. The compiler proves structs initialize. A test you had to force with fake data hides the real invariant.

## Decision Framework: What to Test

| Worth testing | Not worth testing |
|---|---|
| Business logic edge cases (date clamping, negative values) | Go struct initialization |
| Error handling (wrong plan ID, missing price) | Nil guard you'll never hit in production |
| State transitions (subscription states, plan downgrades) | Mock-heavy integration that diverges from prod |
| Regression-catching (the bug would fail this test) | "Works on my machine" smoke tests |
| Pure function with deterministic inputs | Functions requiring full Manager/DB setup |

## Patterns for This Codebase

**Time-dependent billing:** Always use the `At` variant.
```go
// Test date clamping: anchor 31st in February
billingPeriodFromAnchorAt(sub, mustParse("2026-02-10"))
// wantStart: Jan 31, wantEnd: Feb 28 (clamped)
```

**Stripe subscription items:** Test with real `stripe.SubscriptionItem` structs, not mocks. Vary the Price field: nil, overage-only, base plan + overage combo. See `billing_test.go:TestPlanFromSubscriptionItems`.

**Overage delta:** Pure math — test with table-driven subcases. Zero overage, positive overage, negative input (should clamp to 0). See `usage_test.go:TestOverageDeltaHours`.

**Usage rollup with partial Stripe failure:** Use `sqlmock` for DB + a fake Stripe callback. Verify that CPU success + GPU failure marks only CPU as reported. See `usage_rollup_test.go`.

## Key Files

- `billing_test.go` — plan extraction, billing period, month clamping, stage deactivation ordering
- `usage_test.go` — `ceilHours`, `overageDeltaHours`
- `usage_rollup_test.go` — partial Stripe failure, both-succeed, both-fail, free user, no-overage
- `redis_test.go` — distributed lock, CLI sessions, rate limiter, cancel flag (via miniredis)
