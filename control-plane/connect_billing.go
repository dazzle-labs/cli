package main

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	apiv1internal "github.com/browser-streamer/control-plane/internal/gen/api/v1"
)

// billingServer implements apiv1internalconnect.BillingServiceHandler.
type billingServer struct {
	mgr *Manager
}

func (s *billingServer) CreateCheckoutSession(ctx context.Context, req *connect.Request[apiv1internal.CreateCheckoutSessionRequest]) (*connect.Response[apiv1internal.CreateCheckoutSessionResponse], error) {
	info := mustAuth(ctx)

	plan := req.Msg.Plan
	if plan != PlanStarter && plan != PlanPro {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("plan must be 'starter' or 'pro'"))
	}

	if !s.mgr.stripeConfig.isConfigured() {
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("billing not configured"))
	}

	email := dbGetUserEmail(s.mgr.db, info.UserID)
	successURL := s.mgr.publicBaseURL + "/billing?success=true"
	cancelURL := s.mgr.publicBaseURL + "/billing?canceled=true"

	url, err := createCheckoutSession(&s.mgr.stripeConfig, s.mgr.db, info.UserID, email, plan, successURL, cancelURL)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1internal.CreateCheckoutSessionResponse{
		CheckoutUrl: url,
	}), nil
}

func (s *billingServer) CreatePortalSession(ctx context.Context, req *connect.Request[apiv1internal.CreatePortalSessionRequest]) (*connect.Response[apiv1internal.CreatePortalSessionResponse], error) {
	info := mustAuth(ctx)

	url, err := createPortalSession(s.mgr.db, info.UserID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1internal.CreatePortalSessionResponse{
		PortalUrl: url,
	}), nil
}

func (s *billingServer) GetUsage(ctx context.Context, req *connect.Request[apiv1internal.GetUsageRequest]) (*connect.Response[apiv1internal.GetUsageResponse], error) {
	info := mustAuth(ctx)

	plan := dbGetUserPlan(s.mgr.db, info.UserID)
	periodStart := currentPeriodStart(s.mgr.db, info.UserID)
	cpuSec, gpuSec, err := usageSecondsForPeriod(s.mgr.db, info.UserID, periodStart)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	cpuHrs, gpuHrs := ceilHours(cpuSec), ceilHours(gpuSec)

	// Get remaining free minutes from grants
	cpuFreeMin, _ := remainingFreeMinutes(s.mgr.db, info.UserID, "cpu")
	gpuFreeMin, _ := remainingFreeMinutes(s.mgr.db, info.UserID, "gpu")

	overageEnabled, overageLimitCents := dbGetOverageSettings(s.mgr.db, info.UserID)

	// Compute current metered spend from grants
	cpuSpent, _ := meteredSpendCents(s.mgr.db, info.UserID, "cpu", periodStart)
	gpuSpent, _ := meteredSpendCents(s.mgr.db, info.UserID, "gpu", periodStart)
	spentCents := int32(cpuSpent + gpuSpent)

	var limitCents int32
	if overageLimitCents != nil {
		limitCents = int32(*overageLimitCents)
	}

	return connect.NewResponse(&apiv1internal.GetUsageResponse{
		Plan:                plan,
		CpuHoursUsed:       int32(cpuHrs),
		GpuHoursUsed:       int32(gpuHrs),
		CpuHoursIncluded:   int32(ceilToHours(cpuFreeMin)), // remaining free hours
		GpuHoursIncluded:   int32(ceilToHours(gpuFreeMin)),
		CurrentPeriodStart: periodStart.Format("2006-01-02T15:04:05Z"),
		CurrentPeriodEnd:   addMonthClamped(periodStart, 1).Format("2006-01-02T15:04:05Z"),
		OverageEnabled:     overageEnabled,
		OverageLimitCents:  limitCents,
		OverageSpentCents:  spentCents,
	}), nil
}

func (s *billingServer) UpdateOverageSettings(ctx context.Context, req *connect.Request[apiv1internal.UpdateOverageSettingsRequest]) (*connect.Response[apiv1internal.UpdateOverageSettingsResponse], error) {
	info := mustAuth(ctx)

	if req.Msg.OverageLimitCents < 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("overage_limit_cents must be >= 0"))
	}

	// OverageLimitCents: 0 = no cap (default), >0 = explicit spending cap.
	// We use nil internally to represent "no cap".
	var limitCents *int
	if req.Msg.OverageLimitCents > 0 {
		v := int(req.Msg.OverageLimitCents)
		limitCents = &v
	}

	// Atomically check plan and update settings in one query to prevent TOCTOU
	// where a concurrent downgrade to free could leave overage enabled on a free plan.
	if err := dbUpdateOverageSettingsIfPaid(s.mgr.db, info.UserID, req.Msg.OverageEnabled, limitCents); err != nil {
		if err == errFreePlanOverage {
			return nil, connect.NewError(connect.CodePermissionDenied, fmt.Errorf("overage is not available on the free plan"))
		}
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var respLimit int32
	if limitCents != nil {
		respLimit = int32(*limitCents)
	}
	return connect.NewResponse(&apiv1internal.UpdateOverageSettingsResponse{
		OverageEnabled:    req.Msg.OverageEnabled,
		OverageLimitCents: respLimit,
	}), nil
}
