package main

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"fmt"
	"log"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// recordStageActivation inserts a usage_events row when a stage starts running.
// Uses ON CONFLICT to prevent duplicate open events for the same stage (race protection).
func recordStageActivation(db *sql.DB, userID, stageID, provider string) error {
	if db == nil {
		return nil
	}
	id := uuid.Must(uuid.NewV7()).String()
	_, err := db.Exec(`
		INSERT INTO usage_events (id, user_id, stage_id, provider, started_at)
		VALUES ($1, $2, $3, $4, NOW())
		ON CONFLICT (stage_id) WHERE ended_at IS NULL DO NOTHING`,
		id, userID, stageID, provider)
	return err
}

// recordStageDeactivation closes the open usage event for a stage.
// Returns the number of rows affected so callers can detect no-ops from concurrent deactivation.
func recordStageDeactivation(db *sql.DB, stageID string) error {
	if db == nil {
		return nil
	}
	res, err := db.Exec(`
		UPDATE usage_events
		SET ended_at = NOW(),
		    duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
		WHERE stage_id = $1 AND ended_at IS NULL`,
		stageID)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		log.Printf("WARN: recordStageDeactivation: no open usage event for stage %s (already closed or concurrent deactivation)", stageID)
	}
	return nil
}

// ceilHours converts seconds to hours, rounding up (any partial hour = 1 hour).
func ceilHours(sec int) int {
	if sec <= 0 {
		return 0
	}
	return (sec + 3599) / 3600
}

// usageSecondsForPeriod returns raw CPU and GPU seconds used by a user since periodStart.
// Includes both completed events and in-progress events (using wall-clock for open events).
func usageSecondsForPeriod(db *sql.DB, userID string, periodStart time.Time) (cpuSec, gpuSec int, err error) {
	rows, err := db.Query(`
		SELECT provider,
		       COALESCE(SUM(
		           CASE WHEN ended_at IS NOT NULL THEN duration_seconds
		                ELSE EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
		           END
		       ), 0) AS total_seconds
		FROM usage_events
		WHERE user_id = $1 AND started_at >= $2
		GROUP BY provider`,
		userID, periodStart)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()

	for rows.Next() {
		var provider string
		var totalSec int
		if err := rows.Scan(&provider, &totalSec); err != nil {
			return 0, 0, err
		}
		switch provider {
		case "cpu":
			cpuSec = totalSec
		case "gpu":
			gpuSec = totalSec
		}
	}
	return cpuSec, gpuSec, rows.Err()
}

// usageForPeriod returns CPU and GPU hours used by a user since periodStart.
// Hours are ceiling-rounded (any partial hour counts as a full hour).
func usageForPeriod(db *sql.DB, userID string, periodStart time.Time) (cpuHrs, gpuHrs int, err error) {
	cpuSec, gpuSec, err := usageSecondsForPeriod(db, userID, periodStart)
	if err != nil {
		return 0, 0, err
	}
	return ceilHours(cpuSec), ceilHours(gpuSec), nil
}

// unreportedEvents holds per-provider totals and the specific event IDs that were aggregated.
type unreportedEvents struct {
	CPUSec   int
	GPUSec   int
	EventIDs []string // specific IDs, for marking only these as reported
}

// collectUnreportedEvents returns unreported completed usage events for a user since periodStart,
// locking them with FOR UPDATE within the given transaction to prevent concurrent rollups
// from processing the same events.
func collectUnreportedEvents(tx *sql.Tx, userID string, periodStart time.Time) (unreportedEvents, error) {
	rows, err := tx.Query(`
		SELECT id, provider, duration_seconds
		FROM usage_events
		WHERE user_id = $1 AND started_at >= $2
		  AND reported_to_stripe = FALSE AND ended_at IS NOT NULL
		FOR UPDATE`,
		userID, periodStart)
	if err != nil {
		return unreportedEvents{}, err
	}
	defer rows.Close()

	var result unreportedEvents
	for rows.Next() {
		var id, provider string
		var durSec int
		if err := rows.Scan(&id, &provider, &durSec); err != nil {
			return unreportedEvents{}, err
		}
		result.EventIDs = append(result.EventIDs, id)
		switch provider {
		case "cpu":
			result.CPUSec += durSec
		case "gpu":
			result.GPUSec += durSec
		}
	}
	return result, rows.Err()
}

// unreportedUsageSecondsForPeriod returns raw CPU and GPU seconds from unreported completed events.
func unreportedUsageSecondsForPeriod(db *sql.DB, userID string, periodStart time.Time) (cpuSec, gpuSec int, err error) {
	rows, err := db.Query(`
		SELECT provider,
		       COALESCE(SUM(duration_seconds), 0) AS total_seconds
		FROM usage_events
		WHERE user_id = $1 AND started_at >= $2
		  AND reported_to_stripe = FALSE AND ended_at IS NOT NULL
		GROUP BY provider`,
		userID, periodStart)
	if err != nil {
		return 0, 0, err
	}
	defer rows.Close()

	for rows.Next() {
		var provider string
		var totalSec int
		if err := rows.Scan(&provider, &totalSec); err != nil {
			return 0, 0, err
		}
		switch provider {
		case "cpu":
			cpuSec = totalSec
		case "gpu":
			gpuSec = totalSec
		}
	}
	return cpuSec, gpuSec, rows.Err()
}

// unreportedUsageForPeriod returns CPU and GPU hours from unreported completed events only.
// Hours are ceiling-rounded.
func unreportedUsageForPeriod(db *sql.DB, userID string, periodStart time.Time) (cpuHrs, gpuHrs int, err error) {
	cpuSec, gpuSec, err := unreportedUsageSecondsForPeriod(db, userID, periodStart)
	if err != nil {
		return 0, 0, err
	}
	return ceilHours(cpuSec), ceilHours(gpuSec), nil
}

// currentPeriodStart returns the billing period start for a user.
// For paid users it uses the subscription period; for free users it's the 1st of the current month.
// Returns an error on DB failures (other than no rows) so callers can decide whether to proceed.
func currentPeriodStart(db *sql.DB, userID string) time.Time {
	start, err := currentPeriodStartErr(db, userID)
	if err != nil {
		log.Printf("WARN: currentPeriodStart for user %s: %v — falling back to month start", userID, err)
		now := time.Now().UTC()
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	}
	return start
}

func currentPeriodStartErr(db *sql.DB, userID string) (time.Time, error) {
	var start time.Time
	err := db.QueryRow(`
		SELECT current_period_start FROM subscriptions
		WHERE user_id = $1 AND status = 'active'
		ORDER BY created_at DESC LIMIT 1`, userID).Scan(&start)
	if err == sql.ErrNoRows {
		// Free users: beginning of current month
		now := time.Now().UTC()
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC), nil
	}
	if err != nil {
		return time.Time{}, fmt.Errorf("query subscription period: %w", err)
	}
	return start, nil
}

// reconcileUsageEvents closes any orphaned usage events (ended_at IS NULL)
// for stages that are no longer running. Uses a single batch UPDATE instead
// of N+1 individual queries.
func reconcileUsageEvents(db *sql.DB, runningStageIDs map[string]bool) {
	if db == nil {
		return
	}

	// Guard: also exclude stages that are starting/running in the DB but haven't
	// made it into the in-memory map yet (race with activateStageAsync).
	const dbGuard = `AND NOT EXISTS (
		SELECT 1 FROM stages s
		WHERE s.id = usage_events.stage_id
		  AND s.status IN ('starting', 'running')
	)`

	// Collect running stage IDs for the NOT IN clause. If none are running,
	// close all open events in one shot (still excluding DB-active stages).
	if len(runningStageIDs) == 0 {
		res, err := db.Exec(`
			UPDATE usage_events
			SET ended_at = NOW(),
			    duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
			WHERE ended_at IS NULL ` + dbGuard)
		if err != nil {
			log.Printf("WARN: reconcile usage events (batch): %v", err)
		} else if n, _ := res.RowsAffected(); n > 0 {
			log.Printf("Reconciled %d orphaned usage events (no running stages)", n)
		}
		return
	}

	// Build a slice of running IDs for pq.Array
	ids := make([]string, 0, len(runningStageIDs))
	for id := range runningStageIDs {
		ids = append(ids, id)
	}

	res, err := db.Exec(`
		UPDATE usage_events
		SET ended_at = NOW(),
		    duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
		WHERE ended_at IS NULL AND stage_id != ALL($1) `+dbGuard,
		pq.Array(ids))
	if err != nil {
		log.Printf("WARN: reconcile usage events (batch): %v", err)
	} else if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("Reconciled %d orphaned usage events", n)
	}
}

// usageReportResult tracks per-resource-type Stripe reporting success.
// Allows partial success (e.g. CPU reported, GPU failed) so that we can
// mark the successful resource's events as reported without re-billing them.
type usageReportResult struct {
	CPUReported bool
	GPUReported bool
	Err         error // combined error for logging (nil if both succeeded or neither attempted)
}

// reportFunc signature for usage rollup — returns per-resource results.
// rollupKey is a deterministic key for idempotency derived from the specific event IDs being reported.
type reportFunc func(userID string, cpuOverageHrs, gpuOverageHrs int, rollupKey string) usageReportResult

// capCheckFunc is called after each user's rollup to enforce spending caps.
// The implementation should check the user's current metered spend against their cap
// and deactivate stages if the cap is exceeded.
type capCheckFunc func(userID string)

// runUsageRollupJob runs every hour and reports completed usage events to Stripe.
func runUsageRollupJob(ctx context.Context, db *sql.DB, fn reportFunc, capFn capCheckFunc) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := rollupUsage(db, fn, capFn); err != nil {
				log.Printf("ERROR: usage rollup: %v", err)
			}
		}
	}
}

// rollupUsage finds unreported completed usage events, computes overage, and reports to Stripe.
func rollupUsage(db *sql.DB, fn reportFunc, capFn capCheckFunc) error {
	// Get distinct users with unreported events (batch to prevent memory pressure
	// during extended Stripe outages).
	rows, err := db.Query(`
		SELECT DISTINCT user_id FROM usage_events
		WHERE reported_to_stripe = FALSE AND ended_at IS NOT NULL
		LIMIT 1000`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var userIDs []string
	for rows.Next() {
		var uid string
		if err := rows.Scan(&uid); err != nil {
			return err
		}
		userIDs = append(userIDs, uid)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, userID := range userIDs {
		if err := rollupUserUsage(db, userID, fn); err != nil {
			log.Printf("ERROR: rollup for user %s: %v", userID, err)
		}
		// Enforce spending cap after rollup — deactivate stages if cap exceeded.
		if capFn != nil {
			capFn(userID)
		}
	}
	return nil
}

func rollupUserUsage(db *sql.DB, userID string, fn reportFunc) error {
	periodStart := currentPeriodStart(db, userID)

	// Within a transaction: lock unreported events, consume grants, report to Stripe,
	// then mark as reported. All-or-nothing: if Stripe fails, the tx rolls back and
	// events remain unreported for the next rollup cycle.
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	events, err := collectUnreportedEvents(tx, userID, periodStart)
	if err != nil {
		return err
	}
	if len(events.EventIDs) == 0 {
		return nil // nothing to process
	}

	// Grants track minutes, so ceil seconds → minutes for grant consumption.
	cpuMinutes := ceilToMinutes(events.CPUSec)
	gpuMinutes := ceilToMinutes(events.GPUSec)

	// Consume minutes from grants FIFO — free grants first, then metered.
	// Pass raw seconds so consumeResult can track MeteredSeconds for accurate hour rounding.
	var cpuResult, gpuResult consumeResult
	if cpuMinutes > 0 {
		cpuResult, err = consumeMinutesTx(tx, userID, "cpu", cpuMinutes, events.CPUSec)
		if err != nil {
			return err
		}
	}
	if gpuMinutes > 0 {
		gpuResult, err = consumeMinutesTx(tx, userID, "gpu", gpuMinutes, events.GPUSec)
		if err != nil {
			return err
		}
	}

	// Report metered overage to Stripe BEFORE marking events as reported.
	// If Stripe fails, the transaction rolls back — events stay unreported
	// and will be retried on the next rollup cycle. The idempotency key
	// prevents double-billing if Stripe received but we didn't get the ACK.
	//
	// Use raw metered seconds → hours (single ceil) to avoid double-rounding.
	// Grants consume in ceil'd minutes, but Stripe bills in ceil'd hours from
	// the raw seconds to prevent compounding (e.g. 3601s = 2hrs, not 61min→2hrs).
	cpuOverageHrs := ceilHours(cpuResult.MeteredSeconds)
	gpuOverageHrs := ceilHours(gpuResult.MeteredSeconds)

	if (cpuOverageHrs > 0 || gpuOverageHrs > 0) && fn != nil {
		sort.Strings(events.EventIDs)
		rollupKey := fmt.Sprintf("%s:%s", userID, hashEventIDs(events.EventIDs))
		result := fn(userID, cpuOverageHrs, gpuOverageHrs, rollupKey)
		if result.Err != nil {
			// Stripe failed — roll back so events stay unreported for retry.
			log.Printf("WARN: Stripe report for user %s (cpu=%v, gpu=%v): %v",
				userID, result.CPUReported, result.GPUReported, result.Err)
			return result.Err
		}
	}

	// Mark events as reported only after Stripe succeeded.
	if _, err := tx.Exec(`
		UPDATE usage_events SET reported_to_stripe = TRUE
		WHERE id = ANY($1)`, pq.Array(events.EventIDs)); err != nil {
		return err
	}

	return tx.Commit()
}

// hashEventIDs produces a short deterministic hash of event IDs for use as an idempotency key suffix.
func hashEventIDs(ids []string) string {
	h := sha256.Sum256([]byte(strings.Join(ids, ",")))
	return hex.EncodeToString(h[:8]) // 16-char hex = 64 bits, sufficient for idempotency
}
