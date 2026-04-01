package main

import (
	"testing"
	"time"

	"github.com/stripe/stripe-go/v82"
)

func TestPlanFromPriceID(t *testing.T) {
	sc := stripeConfig{
		PriceStarter:           "price_starter_123",
		PricePro:               "price_pro_456",
		PriceCPUOverageStarter: "price_cpu_overage_starter",
		PriceCPUOveragePro:     "price_cpu_overage_pro",
	}

	tests := []struct {
		priceID string
		want    string
	}{
		{"price_starter_123", PlanStarter},
		{"price_pro_456", PlanPro},
		{"price_cpu_overage_starter", ""}, // overage prices are not base plans
		{"price_cpu_overage_pro", ""},
		{"price_unknown", ""},
		{"", ""},
	}

	for _, tt := range tests {
		got := sc.planFromPriceID(tt.priceID)
		if got != tt.want {
			t.Errorf("planFromPriceID(%q) = %q, want %q", tt.priceID, got, tt.want)
		}
	}
}

func TestPlanFromPriceID_Unconfigured(t *testing.T) {
	sc := stripeConfig{}
	if got := sc.planFromPriceID("price_anything"); got != "" {
		t.Errorf("expected empty for unconfigured, got %q", got)
	}
}

func TestPlanFromSubscriptionItems(t *testing.T) {
	sc := stripeConfig{
		PriceStarter:           "price_starter_123",
		PricePro:               "price_pro_456",
		PriceCPUOverageStarter: "price_cpu_overage_starter",
		PriceGPUOveragePro:     "price_gpu_overage_pro",
	}

	t.Run("finds starter plan from items", func(t *testing.T) {
		sub := &stripe.Subscription{
			Items: &stripe.SubscriptionItemList{
				Data: []*stripe.SubscriptionItem{
					{Price: &stripe.Price{ID: "price_starter_123"}},
					{Price: &stripe.Price{ID: "price_cpu_overage_starter"}}, // overage item
				},
			},
		}
		if got := sc.planFromSubscriptionItems(sub); got != PlanStarter {
			t.Errorf("got %q, want %q", got, PlanStarter)
		}
	})

	t.Run("finds pro plan from items", func(t *testing.T) {
		sub := &stripe.Subscription{
			Items: &stripe.SubscriptionItemList{
				Data: []*stripe.SubscriptionItem{
					{Price: &stripe.Price{ID: "price_gpu_overage_pro"}}, // overage first
					{Price: &stripe.Price{ID: "price_pro_456"}},        // base plan second
				},
			},
		}
		if got := sc.planFromSubscriptionItems(sub); got != PlanPro {
			t.Errorf("got %q, want %q", got, PlanPro)
		}
	})

	t.Run("returns empty when no base plan item", func(t *testing.T) {
		sub := &stripe.Subscription{
			Items: &stripe.SubscriptionItemList{
				Data: []*stripe.SubscriptionItem{
					{Price: &stripe.Price{ID: "price_cpu_overage_starter"}},
				},
			},
		}
		if got := sc.planFromSubscriptionItems(sub); got != "" {
			t.Errorf("got %q, want empty", got)
		}
	})

	t.Run("returns empty for nil items", func(t *testing.T) {
		sub := &stripe.Subscription{}
		if got := sc.planFromSubscriptionItems(sub); got != "" {
			t.Errorf("got %q, want empty", got)
		}
	})

	t.Run("returns empty for nil subscription", func(t *testing.T) {
		if got := sc.planFromSubscriptionItems(nil); got != "" {
			t.Errorf("got %q, want empty", got)
		}
	})

	t.Run("handles item with nil Price", func(t *testing.T) {
		sub := &stripe.Subscription{
			Items: &stripe.SubscriptionItemList{
				Data: []*stripe.SubscriptionItem{
					{Price: nil},
					{Price: &stripe.Price{ID: "price_pro_456"}},
				},
			},
		}
		if got := sc.planFromSubscriptionItems(sub); got != PlanPro {
			t.Errorf("got %q, want %q", got, PlanPro)
		}
	})
}

func TestAddMonthClamped(t *testing.T) {
	tests := []struct {
		name   string
		t      time.Time
		months int
		want   time.Time
	}{
		{
			name:   "normal month",
			t:      time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC),
			months: 1,
			want:   time.Date(2026, 2, 15, 0, 0, 0, 0, time.UTC),
		},
		{
			name:   "jan 31 to feb clamps to 28",
			t:      time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC),
			months: 1,
			want:   time.Date(2026, 2, 28, 0, 0, 0, 0, time.UTC),
		},
		{
			name:   "jan 31 to feb in leap year clamps to 29",
			t:      time.Date(2028, 1, 31, 0, 0, 0, 0, time.UTC),
			months: 1,
			want:   time.Date(2028, 2, 29, 0, 0, 0, 0, time.UTC),
		},
		{
			name:   "jan 30 to feb clamps to 28",
			t:      time.Date(2026, 1, 30, 0, 0, 0, 0, time.UTC),
			months: 1,
			want:   time.Date(2026, 2, 28, 0, 0, 0, 0, time.UTC),
		},
		{
			name:   "year rollover",
			t:      time.Date(2026, 12, 15, 0, 0, 0, 0, time.UTC),
			months: 1,
			want:   time.Date(2027, 1, 15, 0, 0, 0, 0, time.UTC),
		},
		{
			name:   "add 12 months",
			t:      time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC),
			months: 12,
			want:   time.Date(2027, 3, 15, 0, 0, 0, 0, time.UTC),
		},
		{
			name:   "zero months is identity",
			t:      time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC),
			months: 0,
			want:   time.Date(2026, 6, 30, 0, 0, 0, 0, time.UTC),
		},
		{
			name:   "march 31 to april 30",
			t:      time.Date(2026, 3, 31, 0, 0, 0, 0, time.UTC),
			months: 1,
			want:   time.Date(2026, 4, 30, 0, 0, 0, 0, time.UTC),
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := addMonthClamped(tt.t, tt.months)
			if !got.Equal(tt.want) {
				t.Errorf("addMonthClamped(%v, %d) = %v, want %v", tt.t, tt.months, got, tt.want)
			}
		})
	}
}

func TestSelectStagesToDeactivate_KeepsOldest(t *testing.T) {
	// 3 running stages, downgrade to plan with max 1 active.
	// Expect the 2 newest to be deactivated — oldest is kept.
	stages := []stageRow{
		{ID: "newest", Status: "running", Capabilities: []string{}, CreatedAt: time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)},
		{ID: "oldest", Status: "running", Capabilities: []string{}, CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)},
		{ID: "middle", Status: "running", Capabilities: []string{}, CreatedAt: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)},
	}
	cfg := PlanConfig{MaxActiveStages: 1}

	result := selectStagesToDeactivate(stages, cfg)

	if len(result) != 2 {
		t.Fatalf("expected 2 to deactivate, got %d: %v", len(result), result)
	}
	for _, id := range result {
		if id == "oldest" {
			t.Errorf("oldest stage should be kept, not deactivated")
		}
	}
}

func TestSelectStagesToDeactivate_MixedCPUGPU(t *testing.T) {
	// Combined limit of 2 — 3 running stages (mix of CPU and GPU), expect 1 deactivated.
	stages := []stageRow{
		{ID: "gpu-old", Status: "running", Capabilities: []string{"gpu"}, CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)},
		{ID: "cpu-1", Status: "running", Capabilities: []string{}, CreatedAt: time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC)},
		{ID: "gpu-new", Status: "running", Capabilities: []string{"gpu"}, CreatedAt: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)},
	}
	cfg := PlanConfig{MaxActiveStages: 2}

	result := selectStagesToDeactivate(stages, cfg)

	if len(result) != 1 {
		t.Fatalf("expected 1 to deactivate, got %d: %v", len(result), result)
	}
	if result[0] != "gpu-new" {
		t.Errorf("expected gpu-new (newest) to be deactivated, got %s", result[0])
	}
}

func TestSelectStagesToDeactivate_SkipsInactive(t *testing.T) {
	stages := []stageRow{
		{ID: "running", Status: "running", Capabilities: []string{}, CreatedAt: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)},
		{ID: "inactive", Status: "inactive", Capabilities: []string{}, CreatedAt: time.Date(2026, 2, 1, 0, 0, 0, 0, time.UTC)},
	}
	cfg := PlanConfig{MaxActiveStages: 1}

	result := selectStagesToDeactivate(stages, cfg)

	if len(result) != 0 {
		t.Fatalf("expected 0 to deactivate, got %d: %v", len(result), result)
	}
}

func TestBillingPeriodFromAnchorAt(t *testing.T) {
	t.Run("nil subscription falls back to month start", func(t *testing.T) {
		now := time.Date(2026, 3, 15, 12, 0, 0, 0, time.UTC)
		start, end := billingPeriodFromAnchorAt(nil, now)
		wantStart := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)
		wantEnd := time.Date(2026, 4, 1, 0, 0, 0, 0, time.UTC)
		if !start.Equal(wantStart) || !end.Equal(wantEnd) {
			t.Errorf("got [%v, %v), want [%v, %v)", start, end, wantStart, wantEnd)
		}
	})

	t.Run("anchor on the 15th, now is mid-cycle", func(t *testing.T) {
		sub := &stripe.Subscription{BillingCycleAnchor: time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC).Unix()}
		now := time.Date(2026, 3, 20, 0, 0, 0, 0, time.UTC) // after the 15th
		start, end := billingPeriodFromAnchorAt(sub, now)
		wantStart := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)
		wantEnd := time.Date(2026, 4, 15, 0, 0, 0, 0, time.UTC)
		if !start.Equal(wantStart) || !end.Equal(wantEnd) {
			t.Errorf("got [%v, %v), want [%v, %v)", start, end, wantStart, wantEnd)
		}
	})

	t.Run("anchor on the 15th, now is before cycle day", func(t *testing.T) {
		sub := &stripe.Subscription{BillingCycleAnchor: time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC).Unix()}
		now := time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC) // before the 15th
		start, end := billingPeriodFromAnchorAt(sub, now)
		wantStart := time.Date(2026, 2, 15, 0, 0, 0, 0, time.UTC)
		wantEnd := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)
		if !start.Equal(wantStart) || !end.Equal(wantEnd) {
			t.Errorf("got [%v, %v), want [%v, %v)", start, end, wantStart, wantEnd)
		}
	})

	t.Run("anchor on the 31st clamps in short months", func(t *testing.T) {
		sub := &stripe.Subscription{BillingCycleAnchor: time.Date(2026, 1, 31, 0, 0, 0, 0, time.UTC).Unix()}
		now := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC) // Feb has no 31st
		start, end := billingPeriodFromAnchorAt(sub, now)
		// Period should be Feb 28 → Mar 31 (clamped)
		wantStart := time.Date(2026, 2, 28, 0, 0, 0, 0, time.UTC)
		wantEnd := time.Date(2026, 3, 31, 0, 0, 0, 0, time.UTC)
		if !start.Equal(wantStart) || !end.Equal(wantEnd) {
			t.Errorf("got [%v, %v), want [%v, %v)", start, end, wantStart, wantEnd)
		}
	})

	t.Run("now exactly on anchor day", func(t *testing.T) {
		sub := &stripe.Subscription{BillingCycleAnchor: time.Date(2026, 1, 15, 0, 0, 0, 0, time.UTC).Unix()}
		now := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC) // exactly on cycle day
		start, end := billingPeriodFromAnchorAt(sub, now)
		wantStart := time.Date(2026, 3, 15, 0, 0, 0, 0, time.UTC)
		wantEnd := time.Date(2026, 4, 15, 0, 0, 0, 0, time.UTC)
		if !start.Equal(wantStart) || !end.Equal(wantEnd) {
			t.Errorf("got [%v, %v), want [%v, %v)", start, end, wantStart, wantEnd)
		}
	})

	t.Run("same month as anchor", func(t *testing.T) {
		sub := &stripe.Subscription{BillingCycleAnchor: time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC).Unix()}
		now := time.Date(2026, 3, 20, 0, 0, 0, 0, time.UTC)
		start, end := billingPeriodFromAnchorAt(sub, now)
		wantStart := time.Date(2026, 3, 10, 0, 0, 0, 0, time.UTC)
		wantEnd := time.Date(2026, 4, 10, 0, 0, 0, 0, time.UTC)
		if !start.Equal(wantStart) || !end.Equal(wantEnd) {
			t.Errorf("got [%v, %v), want [%v, %v)", start, end, wantStart, wantEnd)
		}
	})
}
