---
name: billing-review-patterns
description: >-
  Code review framework for billing, Stripe integration, and metered usage.
  Use when reviewing billing code, adding Stripe webhooks, modifying usage
  metering, changing plan limits, or touching checkout/subscription flows.
allowed-tools: Read, Grep, Glob
---

## Principles

1. **All financial DB writes in one transaction.** Checkout, subscription update, subscription delete — each webhook handler wraps every write in a single `BeginTx`. Side effects (stage deactivation, Stripe API calls) stay outside the tx.

2. **Meter delta, not cumulative.** Stripe meters configured as "sum" receive only the unreported slice each cycle. Track `last_reported_at` per meter and query `WHERE ended_at > last_reported_at`. Reporting cumulative causes N-times overbilling.

3. **Deterministic idempotency keys on every Stripe call.** Format: `{resource}:{userID}:{periodStart}:{amount}`. Prevents double-billing on retry. See `billing.go` meter submission.

4. **Spending cap aggregates ALL resource types.** CPU + GPU overage combined against the single `overage_limit_cents`. Never check one resource type in isolation.

5. **Raw seconds throughout, ceil once at the end.** Mixing rounded hours into subsequent calculations compounds precision errors. `usageSecondsForPeriod` returns seconds; only `ceilHours()` at the final billing/display step.

6. **Budget locks span replicas.** `lockBudget()` uses Redis distributed lock (`lock:budget:{userID}`). Never rely on in-process mutexes alone — two replicas can both pass the cap.

7. **Stage deletion closes open usage events.** `DELETE stage` must also `UPDATE usage_events SET ended_at = NOW() WHERE stage_id = ? AND ended_at IS NULL` in the same transaction. Orphaned events corrupt usage reports.

8. **Expand Stripe objects before reading fields.** Webhook payloads may arrive unexpanded. If `sub.BillingCycleAnchor == 0`, call `subscription.Get(sub.ID)` before using the value.

## Gotchas

- **`IncludedHours: 0` means unlimited**, not zero. The overage check `if includedHrs > 0` skips it entirely. If a resource is truly metered, set a real included-hours value. If unlimited, don't set an overage rate.
- **proto3 `int32` can't distinguish 0 from unset.** Use `optional int32` for fields where zero is a valid business value (e.g., `overage_limit_cents = 0` means "cap at zero spending").
- **Frontend must update from server response, not input.** After `setOverageBudget(limit)`, read `response.overageEnabled` back — the server may have rejected or transformed the value.
- **`deactivateStage` in activation failure has split ownership.** K8s path: `activateStage()` calls `doDeactivateStage()` internally. GPU path: `activateStageAsync()` calls `deactivateStage()` explicitly. Don't double-close the usage event.

## Audit Checklist

When reviewing financial code:

- [ ] All DB writes in checkout/webhook handlers wrapped in a single transaction
- [ ] Stripe meter reports delta since `last_reported_at`, not cumulative
- [ ] Meter submissions include deterministic idempotency keys
- [ ] Spending cap aggregates across CPU + GPU
- [ ] Overage calculations use raw seconds, ceil only at final step
- [ ] Proto uses `optional` for nullable ints, enums for constrained domains
- [ ] DB constraints (`CHECK`) match proto/business rules
- [ ] Stage deletion closes all open usage events transactionally
- [ ] Stripe objects expanded before reading nested fields
- [ ] Frontend updates state from server response, not input values

## Key Files

- `billing.go` — Stripe checkout, subscription webhooks, meter submission
- `usage.go` — `rollupUserUsage()`, `unreportedUsageForPeriod()`
- `connect_stage.go` — activation budget checks, spending cap enforcement
- `connect_billing.go` — `GetUsage`, `SetBudgetLimit` handlers
- `plans.go` — plan definitions, included hours, overage rates
