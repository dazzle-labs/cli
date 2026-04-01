package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	"github.com/lib/pq"
)

// recordStageActivation inserts a usage_events row when a stage starts running.
func recordStageActivation(db *sql.DB, userID, stageID, provider string) error {
	if db == nil {
		return nil
	}
	id := uuid.Must(uuid.NewV7()).String()
	_, err := db.Exec(`
		INSERT INTO usage_events (id, user_id, stage_id, provider, started_at)
		VALUES ($1, $2, $3, $4, NOW())`,
		id, userID, stageID, provider)
	return err
}

// recordStageDeactivation closes the open usage event for a stage.
func recordStageDeactivation(db *sql.DB, stageID string) error {
	if db == nil {
		return nil
	}
	_, err := db.Exec(`
		UPDATE usage_events
		SET ended_at = NOW(),
		    duration_seconds = EXTRACT(EPOCH FROM (NOW() - started_at))::INTEGER
		WHERE stage_id = $1 AND ended_at IS NULL`,
		stageID)
	return err
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
func currentPeriodStart(db *sql.DB, userID string) time.Time {
	var start time.Time
	err := db.QueryRow(`
		SELECT current_period_start FROM subscriptions
		WHERE user_id = $1 AND status = 'active'
		ORDER BY created_at DESC LIMIT 1`, userID).Scan(&start)
	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("WARN: currentPeriodStart query failed for user %s (falling back to month start): %v", userID, err)
		}
		// Free users or query error: beginning of current month
		now := time.Now().UTC()
		return time.Date(now.Year(), now.Month(), 1, 0, 0, 0, 0, time.UTC)
	}
	return start
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
// periodKey is a deterministic key for idempotency (e.g. "user-123:2026-03-01T00:00:00Z").
type reportFunc func(userID string, cpuOverageHrs, gpuOverageHrs int, periodKey string) usageReportResult

// runUsageRollupJob runs every hour and reports completed usage events to Stripe.
func runUsageRollupJob(ctx context.Context, db *sql.DB, fn reportFunc) {
	ticker := time.NewTicker(1 * time.Hour)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := rollupUsage(db, fn); err != nil {
				log.Printf("ERROR: usage rollup: %v", err)
			}
		}
	}
}

// rollupUsage finds unreported completed usage events, computes overage, and reports to Stripe.
func rollupUsage(db *sql.DB, fn reportFunc) error {
	// Get distinct users with unreported events
	rows, err := db.Query(`
		SELECT DISTINCT user_id FROM usage_events
		WHERE reported_to_stripe = FALSE AND ended_at IS NOT NULL`)
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
	}
	return nil
}

func rollupUserUsage(db *sql.DB, userID string, fn reportFunc) error {
	// Get user's plan
	var plan string
	if err := db.QueryRow(`SELECT plan FROM users WHERE id = $1`, userID).Scan(&plan); err != nil {
		return err
	}

	// Get unreported completed usage in minutes per provider
	unreportedCPUSec, unreportedGPUSec, err := unreportedUsageSecondsForPeriod(db, userID, time.Time{}) // all time
	if err != nil {
		return err
	}
	cpuMinutes := ceilToMinutes(unreportedCPUSec)
	gpuMinutes := ceilToMinutes(unreportedGPUSec)

	// Consume minutes from grants FIFO — free grants first, then metered.
	// consumeMinutes returns cost and metered minutes consumed.
	var cpuResult, gpuResult consumeResult
	if cpuMinutes > 0 {
		cpuResult, err = consumeMinutes(db, userID, "cpu", cpuMinutes)
		if err != nil {
			return err
		}
	}
	if gpuMinutes > 0 {
		gpuResult, err = consumeMinutes(db, userID, "gpu", gpuMinutes)
		if err != nil {
			return err
		}
	}

	// Report only metered minutes as overage hours to Stripe (not free-grant-covered minutes).
	cpuOverageHrs := ceilToHours(cpuResult.MeteredMinutes)
	gpuOverageHrs := ceilToHours(gpuResult.MeteredMinutes)

	periodStart := currentPeriodStart(db, userID)
	periodKey := fmt.Sprintf("%s:%s", userID, periodStart.Format(time.RFC3339))
	var result usageReportResult
	if (cpuOverageHrs > 0 || gpuOverageHrs > 0) && fn != nil {
		result = fn(userID, cpuOverageHrs, gpuOverageHrs, periodKey)
	} else {
		result = usageReportResult{CPUReported: true, GPUReported: true}
	}

	if result.Err != nil {
		log.Printf("WARN: partial Stripe report for user %s (cpu=%v, gpu=%v): %v",
			userID, result.CPUReported, result.GPUReported, result.Err)
	}

	// Mark events as reported per-provider
	if result.CPUReported {
		if _, err := db.Exec(`
			UPDATE usage_events SET reported_to_stripe = TRUE
			WHERE user_id = $1 AND provider = 'cpu' AND reported_to_stripe = FALSE AND ended_at IS NOT NULL`, userID); err != nil {
			return err
		}
	}
	if result.GPUReported {
		if _, err := db.Exec(`
			UPDATE usage_events SET reported_to_stripe = TRUE
			WHERE user_id = $1 AND provider = 'gpu' AND reported_to_stripe = FALSE AND ended_at IS NOT NULL`, userID); err != nil {
			return err
		}
	}

	if !result.CPUReported && !result.GPUReported && result.Err != nil {
		return result.Err
	}
	return nil
}
