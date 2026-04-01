package main

import (
	"testing"
)

// Grant consumption tests — these test the core billing logic.
// The rollup function delegates to consumeMinutes, so testing that
// function (with a real DB) is more valuable than mocking the SQL.

func TestGrant_Remaining(t *testing.T) {
	t.Run("prepaid with remaining", func(t *testing.T) {
		mins := 120
		g := Grant{Minutes: &mins, UsedMinutes: 30}
		if got := g.Remaining(); got != 90 {
			t.Errorf("Remaining() = %d, want 90", got)
		}
	})

	t.Run("prepaid fully consumed", func(t *testing.T) {
		mins := 120
		g := Grant{Minutes: &mins, UsedMinutes: 120}
		if got := g.Remaining(); got != 0 {
			t.Errorf("Remaining() = %d, want 0", got)
		}
	})

	t.Run("metered (unlimited)", func(t *testing.T) {
		g := Grant{Minutes: nil, UsedMinutes: 9999}
		if got := g.Remaining(); got != -1 {
			t.Errorf("Remaining() = %d, want -1 (unlimited)", got)
		}
	})
}

func TestGrant_IsFree(t *testing.T) {
	if !(Grant{RateCentsPerHr: 0}).IsFree() {
		t.Error("rate=0 should be free")
	}
	if (Grant{RateCentsPerHr: 90}).IsFree() {
		t.Error("rate=90 should not be free")
	}
}

func TestGrant_IsMetered(t *testing.T) {
	if !(Grant{Minutes: nil}).IsMetered() {
		t.Error("nil minutes should be metered")
	}
	mins := 120
	if (Grant{Minutes: &mins}).IsMetered() {
		t.Error("non-nil minutes should not be metered")
	}
}

func TestCeilToMinutes(t *testing.T) {
	tests := []struct {
		sec, want int
	}{
		{0, 0}, {-1, 0}, {1, 1}, {59, 1}, {60, 1}, {61, 2}, {120, 2}, {121, 3},
	}
	for _, tt := range tests {
		if got := ceilToMinutes(tt.sec); got != tt.want {
			t.Errorf("ceilToMinutes(%d) = %d, want %d", tt.sec, got, tt.want)
		}
	}
}

func TestCeilToHoursFromMinutes(t *testing.T) {
	tests := []struct {
		min, want int
	}{
		{0, 0}, {-1, 0}, {1, 1}, {59, 1}, {60, 1}, {61, 2}, {120, 2}, {121, 3},
	}
	for _, tt := range tests {
		if got := ceilToHours(tt.min); got != tt.want {
			t.Errorf("ceilToHours(%d) = %d, want %d", tt.min, got, tt.want)
		}
	}
}

func TestPlanGrantTemplates(t *testing.T) {
	// Verify plan grant templates are consistent with pricing model
	starter := PlanGrants[PlanStarter]
	if starter.CPUBudgetMinutes != 45000 {
		t.Errorf("Starter CPU budget = %d, want 45000 (750 hrs)", starter.CPUBudgetMinutes)
	}
	if starter.CPUOverageRatePerHr != 15 {
		t.Errorf("Starter CPU overage = %d, want 15 ($0.15/hr)", starter.CPUOverageRatePerHr)
	}
	if starter.GPUOverageRatePerHr != 90 {
		t.Errorf("Starter GPU overage = %d, want 90 ($0.90/hr)", starter.GPUOverageRatePerHr)
	}

	pro := PlanGrants[PlanPro]
	if pro.CPUBudgetMinutes != 90000 {
		t.Errorf("Pro CPU budget = %d, want 90000 (1500 hrs)", pro.CPUBudgetMinutes)
	}
	if pro.CPUOverageRatePerHr != 8 {
		t.Errorf("Pro CPU overage = %d, want 8 ($0.08/hr)", pro.CPUOverageRatePerHr)
	}
	if pro.GPUOverageRatePerHr != 70 {
		t.Errorf("Pro GPU overage = %d, want 70 ($0.70/hr)", pro.GPUOverageRatePerHr)
	}

	free := PlanGrants[PlanFree]
	if free.CPUBudgetMinutes != 1440 {
		t.Errorf("Free CPU budget = %d, want 1440 (24 hrs)", free.CPUBudgetMinutes)
	}
	if free.CPUOverageRatePerHr != 0 {
		t.Errorf("Free should have no CPU overage rate")
	}
	if free.GPUOverageRatePerHr != 0 {
		t.Errorf("Free should have no GPU overage rate")
	}
}
