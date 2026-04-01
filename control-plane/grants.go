package main

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

// Grant represents a usage_grants row.
type Grant struct {
	ID             string
	UserID         string
	Resource       string // "cpu" or "gpu"
	Minutes        *int   // nil = unlimited (metered)
	UsedMinutes    int
	RateCentsPerHr int // 0 = free, >0 = billed per hour
	Reason         string
	ExpiresAt      *time.Time
	CreatedAt      time.Time
}

// Remaining returns the minutes left on this grant, or -1 if unlimited (metered).
func (g Grant) Remaining() int {
	if g.Minutes == nil {
		return -1
	}
	return max(0, *g.Minutes-g.UsedMinutes)
}

// IsFree returns true if this grant has no per-hour rate (prepaid or budget).
func (g Grant) IsFree() bool {
	return g.RateCentsPerHr == 0
}

// IsMetered returns true if this grant has unlimited minutes (PAYG).
func (g Grant) IsMetered() bool {
	return g.Minutes == nil
}

// activeGrants returns all active grants for a user+resource, ordered FIFO
// (free first, then cheapest metered, then by creation time).
// Active = not fully consumed AND not expired.
func activeGrants(db *sql.DB, userID, resource string) ([]Grant, error) {
	rows, err := db.Query(`
		SELECT id, user_id, resource, minutes, used_minutes, rate_cents_per_hr, reason, expires_at, created_at
		FROM usage_grants
		WHERE user_id = $1 AND resource = $2
		  AND (minutes IS NULL OR used_minutes < minutes)
		  AND (expires_at IS NULL OR expires_at > NOW())
		ORDER BY rate_cents_per_hr ASC, created_at ASC`,
		userID, resource)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var grants []Grant
	for rows.Next() {
		var g Grant
		if err := rows.Scan(&g.ID, &g.UserID, &g.Resource, &g.Minutes, &g.UsedMinutes,
			&g.RateCentsPerHr, &g.Reason, &g.ExpiresAt, &g.CreatedAt); err != nil {
			return nil, err
		}
		grants = append(grants, g)
	}
	return grants, rows.Err()
}

// remainingFreeMinutes returns total free (rate=0) minutes remaining across active grants.
func remainingFreeMinutes(db *sql.DB, userID, resource string) (int, error) {
	var total sql.NullInt64
	err := db.QueryRow(`
		SELECT SUM(minutes - used_minutes)
		FROM usage_grants
		WHERE user_id = $1 AND resource = $2
		  AND rate_cents_per_hr = 0
		  AND minutes IS NOT NULL
		  AND used_minutes < minutes
		  AND (expires_at IS NULL OR expires_at > NOW())`,
		userID, resource).Scan(&total)
	if err != nil {
		return 0, err
	}
	if !total.Valid {
		return 0, nil
	}
	return int(total.Int64), nil
}

// hasActiveGrant returns true if the user has any active grant for the resource.
func hasActiveGrant(db *sql.DB, userID, resource string) (bool, error) {
	var exists bool
	err := db.QueryRow(`
		SELECT EXISTS(
			SELECT 1 FROM usage_grants
			WHERE user_id = $1 AND resource = $2
			  AND (minutes IS NULL OR used_minutes < minutes)
			  AND (expires_at IS NULL OR expires_at > NOW())
		)`, userID, resource).Scan(&exists)
	return exists, err
}

// consumeMinutes debits minutes from grants in FIFO order (free first, then cheapest metered).
// Returns the cost in cents for any metered minutes consumed.
func consumeMinutes(db *sql.DB, userID, resource string, minutes int) (costCents int, err error) {
	grants, err := activeGrants(db, userID, resource)
	if err != nil {
		return 0, err
	}

	remaining := minutes
	for _, g := range grants {
		if remaining <= 0 {
			break
		}

		var debit int
		if g.IsMetered() {
			debit = remaining // unlimited grant absorbs all remaining
		} else {
			debit = min(remaining, g.Remaining())
		}

		if debit <= 0 {
			continue
		}

		if _, err := db.Exec(`UPDATE usage_grants SET used_minutes = used_minutes + $1 WHERE id = $2`,
			debit, g.ID); err != nil {
			return costCents, err
		}

		if g.RateCentsPerHr > 0 {
			// Convert metered minutes to hourly billing: ceil(minutes/60) * rate
			costCents += ceilToHours(debit) * g.RateCentsPerHr
		}

		remaining -= debit
	}

	return costCents, nil
}

// metered spend for a user+resource across active metered grants this period.
func meteredSpendCents(db *sql.DB, userID, resource string, periodStart time.Time) (int, error) {
	// Sum used_minutes on metered grants (rate > 0) created during or active in this period.
	rows, err := db.Query(`
		SELECT used_minutes, rate_cents_per_hr
		FROM usage_grants
		WHERE user_id = $1 AND resource = $2
		  AND rate_cents_per_hr > 0
		  AND (minutes IS NULL OR used_minutes < minutes)
		  AND (expires_at IS NULL OR expires_at > NOW())
		  AND created_at >= $3`,
		userID, resource, periodStart)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	var total int
	for rows.Next() {
		var usedMin, rate int
		if err := rows.Scan(&usedMin, &rate); err != nil {
			return 0, err
		}
		total += ceilToHours(usedMin) * rate
	}
	return total, rows.Err()
}

// ceilToHours converts minutes to hours, rounding up (any partial hour = 1 hour).
func ceilToHours(minutes int) int {
	if minutes <= 0 {
		return 0
	}
	return (minutes + 59) / 60
}

// ceilToMinutes converts seconds to minutes, rounding up.
func ceilToMinutes(sec int) int {
	if sec <= 0 {
		return 0
	}
	return (sec + 59) / 60
}

// --- Grant issuance ---

// issueGrant creates a new usage grant.
func issueGrant(db *sql.DB, userID, resource string, minutes *int, rateCentsPerHr int, reason string, expiresAt *time.Time) error {
	id := uuid.Must(uuid.NewV7()).String()
	_, err := db.Exec(`
		INSERT INTO usage_grants (id, user_id, resource, minutes, rate_cents_per_hr, reason, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		id, userID, resource, minutes, rateCentsPerHr, reason, expiresAt)
	return err
}

// issueGrantTx creates a new usage grant within a transaction.
func issueGrantTx(tx *sql.Tx, userID, resource string, minutes *int, rateCentsPerHr int, reason string, expiresAt *time.Time) error {
	id := uuid.Must(uuid.NewV7()).String()
	_, err := tx.Exec(`
		INSERT INTO usage_grants (id, user_id, resource, minutes, rate_cents_per_hr, reason, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		id, userID, resource, minutes, rateCentsPerHr, reason, expiresAt)
	return err
}

// issueSignupGrant creates the one-time GPU trial grant if the user doesn't already have one.
func issueSignupGrant(db *sql.DB, userID string) error {
	var exists bool
	if err := db.QueryRow(`
		SELECT EXISTS(SELECT 1 FROM usage_grants WHERE user_id = $1 AND reason = 'signup' AND resource = 'gpu')`,
		userID).Scan(&exists); err != nil {
		return err
	}
	if exists {
		return nil
	}
	minutes := 120 // 2 hours
	expiresAt := time.Now().Add(365 * 24 * time.Hour)
	return issueGrant(db, userID, "gpu", &minutes, 0, "signup", &expiresAt)
}

// expireMeteredGrants expires all metered (unlimited) grants for a user.
func expireMeteredGrants(db *sql.DB, userID string) error {
	_, err := db.Exec(`
		UPDATE usage_grants SET expires_at = NOW()
		WHERE user_id = $1 AND minutes IS NULL AND (expires_at IS NULL OR expires_at > NOW())`,
		userID)
	return err
}

// expireMeteredGrantsTx expires all metered grants within a transaction.
func expireMeteredGrantsTx(tx *sql.Tx, userID string) error {
	_, err := tx.Exec(`
		UPDATE usage_grants SET expires_at = NOW()
		WHERE user_id = $1 AND minutes IS NULL AND (expires_at IS NULL OR expires_at > NOW())`,
		userID)
	return err
}

// PlanGrantTemplate defines what grants a plan issues on subscription.
type PlanGrantTemplate struct {
	CPUBudgetMinutes    int // monthly budget (0 = none, e.g. free tier uses fixed grant)
	CPUOverageRatePerHr int // cents per hour for metered CPU grant
	GPUOverageRatePerHr int // cents per hour for metered GPU grant
}

var PlanGrants = map[string]PlanGrantTemplate{
	PlanFree: {
		// Free: 10 CPU hrs = 600 min monthly budget, no metered grants
		CPUBudgetMinutes: 600,
	},
	PlanStarter: {
		CPUBudgetMinutes:    45000, // 750 hrs
		CPUOverageRatePerHr: 15,    // $0.15/hr
		GPUOverageRatePerHr: 90,    // $0.90/hr
	},
	PlanPro: {
		CPUBudgetMinutes:    90000, // 1500 hrs
		CPUOverageRatePerHr: 4,     // $0.04/hr
		GPUOverageRatePerHr: 70,    // $0.70/hr
	},
}

// issuePlanGrants creates metered grants for a plan subscription.
// Call within the checkout/subscription-update transaction.
func issuePlanGrants(tx *sql.Tx, userID, plan string) error {
	tmpl, ok := PlanGrants[plan]
	if !ok {
		return nil
	}

	// Issue metered CPU grant (if plan has overage rate)
	if tmpl.CPUOverageRatePerHr > 0 {
		if err := issueGrantTx(tx, userID, "cpu", nil, tmpl.CPUOverageRatePerHr, "metered", nil); err != nil {
			return err
		}
	}

	// Issue metered GPU grant (if plan has overage rate)
	if tmpl.GPUOverageRatePerHr > 0 {
		if err := issueGrantTx(tx, userID, "gpu", nil, tmpl.GPUOverageRatePerHr, "metered", nil); err != nil {
			return err
		}
	}

	return nil
}

// issueMonthlyBudget creates the monthly CPU budget grant for a billing period.
func issueMonthlyBudget(tx *sql.Tx, userID, plan string, periodEnd time.Time) error {
	tmpl, ok := PlanGrants[plan]
	if !ok || tmpl.CPUBudgetMinutes <= 0 {
		return nil
	}
	minutes := tmpl.CPUBudgetMinutes
	return issueGrantTx(tx, userID, "cpu", &minutes, 0, "monthly", &periodEnd)
}

// intPtr is a helper for creating *int values.
func intPtr(v int) *int { return &v }
