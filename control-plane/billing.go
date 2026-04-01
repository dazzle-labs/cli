package main

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/stripe/stripe-go/v82"
	"github.com/stripe/stripe-go/v82/billing/meterevent"
	billingportalsession "github.com/stripe/stripe-go/v82/billingportal/session"
	checkoutsession "github.com/stripe/stripe-go/v82/checkout/session"
	"github.com/stripe/stripe-go/v82/customer"
	"github.com/stripe/stripe-go/v82/subscription"
	"github.com/stripe/stripe-go/v82/webhook"
)

// stripeConfig holds all Stripe-related configuration.
type stripeConfig struct {
	SecretKey     string
	WebhookSecret string

	PriceStarter string
	PricePro     string

	PriceCPUOverageStarter string
	PriceCPUOveragePro     string
	PriceGPUOverageStarter string
	PriceGPUOveragePro     string

	// Billing Meter event names for usage reporting
	MeterEventCPU string // e.g. "cpu_overage_hours"
	MeterEventGPU string // e.g. "gpu_overage_hours"
}

func (sc *stripeConfig) isConfigured() bool {
	return sc.SecretKey != ""
}

// overagePriceIDs returns the CPU and GPU overage price IDs for a plan.
func (sc *stripeConfig) overagePriceIDs(plan string) (cpuPrice, gpuPrice string) {
	switch plan {
	case PlanStarter:
		return sc.PriceCPUOverageStarter, sc.PriceGPUOverageStarter
	case PlanPro:
		return sc.PriceCPUOveragePro, sc.PriceGPUOveragePro
	}
	return "", ""
}

// planPriceID returns the Stripe price ID for a plan.
func (sc *stripeConfig) planPriceID(plan string) string {
	switch plan {
	case PlanStarter:
		return sc.PriceStarter
	case PlanPro:
		return sc.PricePro
	}
	return ""
}

// planFromPriceID reverse-maps a Stripe price ID to a plan name.
// Only checks base plan prices (not overage prices).
func (sc *stripeConfig) planFromPriceID(priceID string) string {
	if priceID == "" {
		return ""
	}
	if sc.PriceStarter != "" && priceID == sc.PriceStarter {
		return PlanStarter
	}
	if sc.PricePro != "" && priceID == sc.PricePro {
		return PlanPro
	}
	return ""
}

// planFromSubscriptionItems derives the plan from a subscription's line items.
// Returns empty string if no base plan price is found.
func (sc *stripeConfig) planFromSubscriptionItems(sub *stripe.Subscription) string {
	if sub == nil || sub.Items == nil {
		return ""
	}
	for _, item := range sub.Items.Data {
		if item.Price != nil {
			if plan := sc.planFromPriceID(item.Price.ID); plan != "" {
				return plan
			}
		}
	}
	return ""
}

// ensureStripeCustomer returns the user's Stripe customer ID, creating one if needed.
// Uses UPDATE ... WHERE stripe_customer_id IS NULL to avoid TOCTOU races where two
// concurrent requests could both create a Stripe customer.
func ensureStripeCustomer(db *sql.DB, userID, email string) (string, error) {
	var existing sql.NullString
	if err := db.QueryRow(`SELECT stripe_customer_id FROM users WHERE id = $1`, userID).Scan(&existing); err != nil {
		return "", fmt.Errorf("query user: %w", err)
	}
	if existing.Valid && existing.String != "" {
		return existing.String, nil
	}

	params := &stripe.CustomerParams{
		Email: stripe.String(email),
		Metadata: map[string]string{
			"user_id": userID,
		},
	}
	cust, err := customer.New(params)
	if err != nil {
		return "", fmt.Errorf("create stripe customer: %w", err)
	}

	// Conditional update: only set if still NULL (prevents race with concurrent request)
	res, err := db.Exec(`UPDATE users SET stripe_customer_id = $2, updated_at = NOW() WHERE id = $1 AND stripe_customer_id IS NULL`,
		userID, cust.ID)
	if err != nil {
		return "", fmt.Errorf("save stripe customer id: %w", err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// Another request won the race — read the winner's customer ID
		if err := db.QueryRow(`SELECT stripe_customer_id FROM users WHERE id = $1`, userID).Scan(&existing); err != nil {
			return "", fmt.Errorf("re-query user: %w", err)
		}
		// Delete the orphaned Stripe customer we just created
		if _, delErr := customer.Del(cust.ID, nil); delErr != nil {
			log.Printf("WARN: failed to delete orphaned Stripe customer %s for user %s: %v", cust.ID, userID, delErr)
		} else {
			log.Printf("Deleted orphaned Stripe customer %s for user %s (race), winner: %s", cust.ID, userID, existing.String)
		}
		return existing.String, nil
	}
	return cust.ID, nil
}

// createCheckoutSession creates a Stripe Checkout session for upgrading to a paid plan.
func createCheckoutSession(sc *stripeConfig, db *sql.DB, userID, email, plan, successURL, cancelURL string) (string, error) {
	priceID := sc.planPriceID(plan)
	if priceID == "" {
		return "", fmt.Errorf("invalid plan: %s", plan)
	}

	customerID, err := ensureStripeCustomer(db, userID, email)
	if err != nil {
		return "", err
	}

	lineItems := []*stripe.CheckoutSessionLineItemParams{
		{
			Price:    stripe.String(priceID),
			Quantity: stripe.Int64(1),
		},
	}

	// Add metered overage line items
	cpuOveragePrice, gpuOveragePrice := sc.overagePriceIDs(plan)
	if cpuOveragePrice != "" {
		lineItems = append(lineItems, &stripe.CheckoutSessionLineItemParams{
			Price: stripe.String(cpuOveragePrice),
		})
	}
	if gpuOveragePrice != "" {
		lineItems = append(lineItems, &stripe.CheckoutSessionLineItemParams{
			Price: stripe.String(gpuOveragePrice),
		})
	}

	params := &stripe.CheckoutSessionParams{
		Customer:   stripe.String(customerID),
		Mode:       stripe.String(string(stripe.CheckoutSessionModeSubscription)),
		LineItems:  lineItems,
		SuccessURL: stripe.String(successURL),
		CancelURL:  stripe.String(cancelURL),
		Metadata: map[string]string{
			"user_id": userID,
			"plan":    plan,
		},
		SubscriptionData: &stripe.CheckoutSessionSubscriptionDataParams{
			Metadata: map[string]string{
				"user_id": userID,
				"plan":    plan,
			},
		},
	}

	sess, err := checkoutsession.New(params)
	if err != nil {
		return "", fmt.Errorf("create checkout session: %w", err)
	}
	return sess.URL, nil
}

// createPortalSession creates a Stripe Customer Portal session.
func createPortalSession(db *sql.DB, userID string) (string, error) {
	var customerID sql.NullString
	if err := db.QueryRow(`SELECT stripe_customer_id FROM users WHERE id = $1`, userID).Scan(&customerID); err != nil {
		return "", fmt.Errorf("query user: %w", err)
	}
	if !customerID.Valid || customerID.String == "" {
		return "", fmt.Errorf("no Stripe customer found")
	}

	params := &stripe.BillingPortalSessionParams{
		Customer: stripe.String(customerID.String),
	}
	sess, err := billingportalsession.New(params)
	if err != nil {
		return "", fmt.Errorf("create portal session: %w", err)
	}
	return sess.URL, nil
}

// handleStripeWebhook processes incoming Stripe webhook events.
func (m *Manager) handleStripeWebhook(w http.ResponseWriter, r *http.Request) {
	if !m.stripeConfig.isConfigured() {
		http.Error(w, "Stripe not configured", http.StatusServiceUnavailable)
		return
	}

	body, err := io.ReadAll(io.LimitReader(r.Body, 524288))
	if err != nil {
		http.Error(w, "read body", http.StatusBadRequest)
		return
	}

	event, err := webhook.ConstructEvent(body, r.Header.Get("Stripe-Signature"), m.stripeConfig.WebhookSecret)
	if err != nil {
		http.Error(w, "invalid signature", http.StatusBadRequest)
		return
	}

	var handleErr error
	switch event.Type {
	case "checkout.session.completed":
		handleErr = m.handleCheckoutCompleted(event)
	case "customer.subscription.updated":
		handleErr = m.handleSubscriptionUpdated(event)
	case "customer.subscription.deleted":
		handleErr = m.handleSubscriptionDeleted(event)
	case "invoice.payment_failed":
		m.handlePaymentFailed(event)
	}

	if handleErr != nil {
		// Return 500 so Stripe retries critical billing mutations
		log.Printf("ERROR: webhook %s failed (will retry): %v", event.Type, handleErr)
		http.Error(w, "internal error", http.StatusInternalServerError)
		return
	}
	w.WriteHeader(http.StatusOK)
}

func (m *Manager) handleCheckoutCompleted(event stripe.Event) error {
	var sess stripe.CheckoutSession
	if err := json.Unmarshal(event.Data.Raw, &sess); err != nil {
		return fmt.Errorf("unmarshal checkout session: %w", err)
	}

	userID := sess.Metadata["user_id"]
	plan := sess.Metadata["plan"]
	if userID == "" || plan == "" {
		// Bad metadata is not retryable — log and accept
		log.Printf("ERROR: checkout missing metadata: user_id=%s plan=%s", userID, plan)
		return nil
	}

	// Validate plan from metadata — don't blindly trust it
	if plan != PlanStarter && plan != PlanPro {
		log.Printf("ERROR: checkout invalid plan in metadata: %s (user %s)", plan, userID)
		return nil
	}

	// Fetch the full subscription from Stripe — webhook payloads may not expand
	// items or include BillingCycleAnchor. This ensures we have accurate data.
	if sess.Subscription == nil || sess.Subscription.ID == "" {
		log.Printf("ERROR: checkout session has no subscription ID (user %s)", userID)
		return nil
	}
	fullSub, err := subscription.Get(sess.Subscription.ID, nil)
	if err != nil {
		return fmt.Errorf("fetch subscription %s: %w", sess.Subscription.ID, err)
	}

	// Cross-reference plan metadata against the subscription's actual line items.
	if derivedPlan := m.stripeConfig.planFromSubscriptionItems(fullSub); derivedPlan != "" {
		if derivedPlan != plan {
			log.Printf("ERROR: checkout plan metadata mismatch: metadata=%s, derived=%s (user %s) — using derived", plan, derivedPlan, userID)
			plan = derivedPlan
		}
	}

	// All three writes must succeed atomically
	tx, err := m.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	// Update user plan and quotas
	cfg := getPlanConfig(plan)
	if _, err := tx.Exec(`
		UPDATE users SET
			plan = $2, max_stages = $3, max_active_cpu_stages = $4,
			max_active_gpu_stages = $4, updated_at = NOW()
		WHERE id = $1`,
		userID, plan, cfg.MaxStages, cfg.MaxActiveStages); err != nil {
		return fmt.Errorf("apply plan limits for user %s: %w", userID, err)
	}

	// Expire old metered grants and issue new ones for the plan
	if err := expireMeteredGrantsTx(tx, userID); err != nil {
		return fmt.Errorf("expire metered grants for user %s: %w", userID, err)
	}
	if err := issuePlanGrants(tx, userID, plan); err != nil {
		return fmt.Errorf("issue plan grants for user %s: %w", userID, err)
	}

	// Store Stripe IDs
	if _, err := tx.Exec(`
		UPDATE users SET stripe_subscription_id = $2, updated_at = NOW() WHERE id = $1`,
		userID, fullSub.ID); err != nil {
		return fmt.Errorf("save subscription ID for user %s: %w", userID, err)
	}

	// Derive billing period from the fully-expanded subscription's BillingCycleAnchor
	periodStart, periodEnd := billingPeriodFromAnchor(fullSub)

	subRecordID := uuid.Must(uuid.NewV7()).String()
	if _, err := tx.Exec(`
		INSERT INTO subscriptions (id, user_id, stripe_subscription_id, stripe_customer_id, plan, status, current_period_start, current_period_end)
		VALUES ($5, $1, $2, $3, $4, 'active', $6, $7)
		ON CONFLICT (stripe_subscription_id) DO UPDATE SET plan = $4, status = 'active', current_period_start = $6, current_period_end = $7, updated_at = NOW()`,
		userID, fullSub.ID, sess.Customer.ID, plan, subRecordID, periodStart, periodEnd); err != nil {
		return fmt.Errorf("upsert subscription for user %s: %w", userID, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit checkout tx for user %s: %w", userID, err)
	}

	log.Printf("User %s upgraded to %s (subscription: %s)", userID, plan, fullSub.ID)
	return nil
}

func (m *Manager) handleSubscriptionUpdated(event stripe.Event) error {
	var sub stripe.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		return fmt.Errorf("unmarshal subscription: %w", err)
	}

	userID := sub.Metadata["user_id"]
	if userID == "" {
		log.Printf("WARN: subscription updated missing user_id metadata: %s", sub.ID)
		return nil
	}

	// Derive plan from subscription's actual line items — metadata is unreliable
	// because Stripe doesn't update custom metadata on portal-initiated plan changes.
	plan := m.stripeConfig.planFromSubscriptionItems(&sub)
	if plan == "" {
		// Fall back to metadata for subscriptions created before price-ID mapping
		plan = sub.Metadata["plan"]
	}

	// Wrap plan change + subscription sync in a single transaction so a partial
	// failure doesn't leave plan and subscription state out of sync.
	tx, err := m.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	var isDowngrade bool

	// Only apply plan limits when the plan actually changed — Stripe fires
	// subscription.updated for many reasons (payment method change, scheduled
	// downgrade queued, etc). We only change quotas when Stripe has actually
	// transitioned the plan, not when a future change is pending.
	if plan != "" {
		currentPlan := dbGetUserPlan(m.db, userID)
		if plan != currentPlan {
			cfg := getPlanConfig(plan)
			if _, err := tx.Exec(`
				UPDATE users SET
					plan = $2, max_stages = $3, max_active_cpu_stages = $4,
					max_active_gpu_stages = $4, updated_at = NOW()
				WHERE id = $1`,
				userID, plan, cfg.MaxStages, cfg.MaxActiveStages); err != nil {
				return fmt.Errorf("apply plan limits for user %s: %w", userID, err)
			}
			log.Printf("User %s plan changed: %s -> %s", userID, currentPlan, plan)

			// Expire old metered grants and issue new ones at new plan rate
			if err := expireMeteredGrantsTx(tx, userID); err != nil {
				return fmt.Errorf("expire metered grants for user %s: %w", userID, err)
			}
			if err := issuePlanGrants(tx, userID, plan); err != nil {
				return fmt.Errorf("issue plan grants for user %s: %w", userID, err)
			}

			planOrder := map[string]int{PlanFree: 0, PlanStarter: 1, PlanPro: 2}
			if planOrder[plan] < planOrder[currentPlan] {
				isDowngrade = true
				if plan == PlanFree {
					if _, err := tx.Exec(`UPDATE users SET overage_enabled = FALSE, overage_limit_cents = NULL, updated_at = NOW() WHERE id = $1`, userID); err != nil {
						log.Printf("WARN: reset overage settings for user %s on downgrade: %v", userID, err)
					}
				}
			}
		}
	}

	// Sync subscription state and period dates from Stripe
	status := string(sub.Status)
	periodStart, periodEnd := billingPeriodFromAnchor(&sub)
	if _, err := tx.Exec(`
		UPDATE subscriptions SET
			status = $2,
			cancel_at_period_end = $3,
			current_period_start = $4,
			current_period_end = $5,
			updated_at = NOW()
		WHERE stripe_subscription_id = $1`,
		sub.ID, status, sub.CancelAtPeriodEnd, periodStart, periodEnd); err != nil {
		return fmt.Errorf("update subscription %s: %w", sub.ID, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit subscription update tx for user %s: %w", userID, err)
	}

	// Deactivate excess stages outside the transaction — side effect that can
	// be retried independently if it fails.
	if isDowngrade && plan != "" {
		m.deactivateExcessStages(userID, plan)
	}
	return nil
}

// billingPeriodFromAnchor derives the current billing period start/end from
// Stripe's BillingCycleAnchor. Stripe v82 removed CurrentPeriodStart/End
// from the Subscription object; the anchor is the stable reference point.
// O(1) — computes the month offset directly instead of walking month by month.
func billingPeriodFromAnchor(sub *stripe.Subscription) (start, end time.Time) {
	return billingPeriodFromAnchorAt(sub, time.Now().UTC())
}

// billingPeriodFromAnchorAt is the testable core — computes the billing period
// containing `now` for the given subscription's billing cycle anchor.
func billingPeriodFromAnchorAt(sub *stripe.Subscription, now time.Time) (start, end time.Time) {
	if sub == nil || sub.BillingCycleAnchor == 0 {
		// Fallback: first of current month
		start = time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
		return start, start.AddDate(0, 1, 0)
	}

	anchor := time.Unix(sub.BillingCycleAnchor, 0).UTC()

	// Compute elapsed months directly: O(1) instead of O(months).
	monthsElapsed := (now.Year()-anchor.Year())*12 + int(now.Month()-anchor.Month())
	// If we haven't reached the anchor's day-of-month yet this month, step back one period
	candidate := addMonthClamped(anchor, monthsElapsed)
	if candidate.After(now) {
		monthsElapsed--
	}
	start = addMonthClamped(anchor, monthsElapsed)
	end = addMonthClamped(anchor, monthsElapsed+1)
	return start, end
}

// addMonthClamped adds n months to t, clamping to the last day of the target
// month if the anchor day doesn't exist (e.g. Jan 31 + 1 month = Feb 28).
func addMonthClamped(t time.Time, months int) time.Time {
	y, m, d := t.Date()
	targetMonth := time.Month(int(m) + months)
	// Normalize: time.Date handles month overflow (e.g. month 13 = Jan next year)
	result := time.Date(y, targetMonth, d, t.Hour(), t.Minute(), t.Second(), 0, t.Location())
	// If the day overflowed (e.g. 31 in a 30-day month), clamp to last day
	if result.Day() != d {
		// Go back to the last day of the target month
		result = time.Date(y, targetMonth+1, 0, t.Hour(), t.Minute(), t.Second(), 0, t.Location())
	}
	return result
}

func (m *Manager) handleSubscriptionDeleted(event stripe.Event) error {
	var sub stripe.Subscription
	if err := json.Unmarshal(event.Data.Raw, &sub); err != nil {
		return fmt.Errorf("unmarshal subscription: %w", err)
	}

	userID := sub.Metadata["user_id"]
	if userID == "" {
		log.Printf("WARN: subscription deleted missing user_id: %s", sub.ID)
		return nil
	}

	// Revert to free plan + mark subscription canceled atomically
	tx, err := m.db.Begin()
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback()

	cfg := getPlanConfig(PlanFree)
	if _, err := tx.Exec(`
		UPDATE users SET
			plan = $2, max_stages = $3, max_active_cpu_stages = $4,
			max_active_gpu_stages = $4, overage_enabled = FALSE,
			overage_limit_cents = NULL, updated_at = NOW()
		WHERE id = $1`,
		userID, PlanFree, cfg.MaxStages, cfg.MaxActiveStages); err != nil {
		return fmt.Errorf("revert to free for user %s: %w", userID, err)
	}

	// Expire metered grants — prepaid grants (trial, promo) survive cancellation
	if err := expireMeteredGrantsTx(tx, userID); err != nil {
		return fmt.Errorf("expire metered grants for user %s: %w", userID, err)
	}

	if _, err := tx.Exec(`
		UPDATE subscriptions SET status = 'canceled', updated_at = NOW()
		WHERE stripe_subscription_id = $1`, sub.ID); err != nil {
		return fmt.Errorf("mark subscription canceled %s: %w", sub.ID, err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit subscription delete tx for user %s: %w", userID, err)
	}

	// Deactivate excess stages outside the transaction — these are side effects
	// that can be retried independently if they fail.
	m.deactivateExcessStages(userID, PlanFree)

	log.Printf("User %s reverted to free plan (subscription %s canceled)", userID, sub.ID)
	return nil
}

// deactivateExcessStages shuts down active stages that exceed the given plan's limits.
// Called on downgrade to enforce the new plan's constraints immediately.
// selectStagesToDeactivate returns stage IDs that exceed the plan's active limits.
// Sorts by creation time ascending so the oldest stages are kept.
func selectStagesToDeactivate(stages []stageRow, cfg PlanConfig) []string {
	sort.Slice(stages, func(i, j int) bool {
		return stages[i].CreatedAt.Before(stages[j].CreatedAt)
	})

	var toDeactivate []string
	activeCount := 0
	for _, st := range stages {
		if st.Status != "running" && st.Status != "starting" {
			continue
		}
		activeCount++
		if activeCount > cfg.MaxActiveStages {
			toDeactivate = append(toDeactivate, st.ID)
		}
	}
	return toDeactivate
}

func (m *Manager) deactivateExcessStages(userID, plan string) {
	cfg := getPlanConfig(plan)

	stages, err := dbListStages(m.db, userID)
	if err != nil {
		log.Printf("ERROR: deactivateExcessStages list for user %s: %v", userID, err)
		return
	}

	for _, id := range selectStagesToDeactivate(stages, cfg) {
		log.Printf("Deactivating excess stage %s for user %s (downgrade to %s)", id, userID, plan)
		if err := m.deactivateStage(id); err != nil {
			log.Printf("ERROR: deactivate excess stage %s: %v", id, err)
		}
	}
}

func (m *Manager) handlePaymentFailed(event stripe.Event) {
	var invoice stripe.Invoice
	if err := json.Unmarshal(event.Data.Raw, &invoice); err != nil {
		log.Printf("ERROR: unmarshal invoice: %v", err)
		return
	}

	// Extract subscription from invoice parent details (Stripe v82+ API)
	var subID string
	if invoice.Parent != nil && invoice.Parent.SubscriptionDetails != nil && invoice.Parent.SubscriptionDetails.Subscription != nil {
		subID = invoice.Parent.SubscriptionDetails.Subscription.ID
	}
	if subID != "" {
		if _, err := m.db.Exec(`
			UPDATE subscriptions SET status = 'past_due', updated_at = NOW()
			WHERE stripe_subscription_id = $1`, subID); err != nil {
			log.Printf("ERROR: mark subscription past_due %s: %v", subID, err)
		}
		log.Printf("Payment failed for subscription %s", subID)
	}
}

// reportStripeUsage reports overage hours to Stripe via Billing Meter Events.
// Reports CPU and GPU independently so a failure in one doesn't block the other.
// Returns per-resource results so the caller can mark events as reported per-provider.
// periodKey is used to construct idempotency keys preventing double-billing on retry.
func (m *Manager) reportStripeUsage(userID string, cpuOverageHrs, gpuOverageHrs int, periodKey string) usageReportResult {
	if !m.stripeConfig.isConfigured() {
		return usageReportResult{CPUReported: true, GPUReported: true}
	}

	var customerID sql.NullString
	if err := m.db.QueryRow(`SELECT stripe_customer_id FROM users WHERE id = $1`, userID).Scan(&customerID); err != nil {
		return usageReportResult{Err: fmt.Errorf("query user %s: %w", userID, err)}
	}
	if !customerID.Valid || customerID.String == "" {
		// No Stripe customer — mark as reported to prevent pile-up
		return usageReportResult{CPUReported: true, GPUReported: true}
	}

	now := time.Now().Unix()
	var result usageReportResult
	var errs []string

	// Report CPU independently — idempotency key prevents double-billing on retry
	if cpuOverageHrs > 0 && m.stripeConfig.MeterEventCPU != "" {
		params := &stripe.BillingMeterEventParams{
			EventName: stripe.String(m.stripeConfig.MeterEventCPU),
			Timestamp: stripe.Int64(now),
			Payload: map[string]string{
				"stripe_customer_id": customerID.String,
				"value":              strconv.Itoa(cpuOverageHrs),
			},
		}
		params.IdempotencyKey = stripe.String(fmt.Sprintf("cpu:%s:%d", periodKey, cpuOverageHrs))
		if _, err := meterevent.New(params); err != nil {
			errs = append(errs, fmt.Sprintf("CPU: %v", err))
		} else {
			result.CPUReported = true
		}
	} else {
		result.CPUReported = true // Nothing to report = success
	}

	// Report GPU independently
	if gpuOverageHrs > 0 && m.stripeConfig.MeterEventGPU != "" {
		params := &stripe.BillingMeterEventParams{
			EventName: stripe.String(m.stripeConfig.MeterEventGPU),
			Timestamp: stripe.Int64(now),
			Payload: map[string]string{
				"stripe_customer_id": customerID.String,
				"value":              strconv.Itoa(gpuOverageHrs),
			},
		}
		params.IdempotencyKey = stripe.String(fmt.Sprintf("gpu:%s:%d", periodKey, gpuOverageHrs))
		if _, err := meterevent.New(params); err != nil {
			errs = append(errs, fmt.Sprintf("GPU: %v", err))
		} else {
			result.GPUReported = true
		}
	} else {
		result.GPUReported = true // Nothing to report = success
	}

	if len(errs) > 0 {
		result.Err = fmt.Errorf("meter event errors for user %s: %s", userID, strings.Join(errs, "; "))
	}

	log.Printf("Usage reported for user %s: CPU overage=%d hrs (ok=%v), GPU overage=%d hrs (ok=%v)",
		userID, cpuOverageHrs, result.CPUReported, gpuOverageHrs, result.GPUReported)
	return result
}
