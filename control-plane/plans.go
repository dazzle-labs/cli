package main

import "database/sql"

const (
	PlanFree    = "free"
	PlanStarter = "starter"
	PlanPro     = "pro"

	VisibilityPublic  = "public"
	VisibilityPrivate = "private"

	Resolution720p  = "720p"
	Resolution1080p = "1080p"
)

// PlanConfig holds per-plan limits enforced at activation time.
// Billing (budgets, rates, overage) is handled by usage_grants — not here.
type PlanConfig struct {
	MaxStages       int
	MaxActiveStages int
	MaxExternalDest int
	CanPrivate      bool
}

var Plans = map[string]PlanConfig{
	PlanFree: {
		MaxStages:       10,
		MaxActiveStages: 1,
		MaxExternalDest: 1,
		CanPrivate:      false,
	},
	PlanStarter: {
		MaxStages:       100,
		MaxActiveStages: 3,
		MaxExternalDest: 1,
		CanPrivate:      false,
	},
	PlanPro: {
		MaxStages:       1000,
		MaxActiveStages: 100,
		MaxExternalDest: 5,
		CanPrivate:      true,
	},
}

func getPlanConfig(plan string) PlanConfig {
	if cfg, ok := Plans[plan]; ok {
		return cfg
	}
	return Plans[PlanFree]
}

// applyPlanLimits updates the per-user quota columns to match the given plan.
func applyPlanLimits(db *sql.DB, userID, plan string) error {
	cfg := getPlanConfig(plan)
	_, err := db.Exec(`
		UPDATE users SET
			plan = $2,
			max_stages = $3,
			max_active_cpu_stages = $4,
			max_active_gpu_stages = $4,
			updated_at = NOW()
		WHERE id = $1`,
		userID, plan, cfg.MaxStages, cfg.MaxActiveStages)
	return err
}
