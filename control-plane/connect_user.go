package main

import (
	"context"

	"connectrpc.com/connect"

	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
)

// userServer implements apiv1connect.UserServiceHandler.
type userServer struct {
	mgr *Manager
}

func (s *userServer) GetProfile(ctx context.Context, req *connect.Request[apiv1.GetProfileRequest]) (*connect.Response[apiv1.GetProfileResponse], error) {
	info := mustAuth(ctx)

	email, name, plan, stageCount, apiKeyCount, err := dbGetUserProfile(s.mgr.db, info.UserID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	cfg := getPlanConfig(plan)
	periodStart := currentPeriodStart(s.mgr.db, info.UserID)
	cpuHrs, gpuHrs, _ := usageForPeriod(s.mgr.db, info.UserID, periodStart)

	cpuFreeMin, _ := remainingFreeMinutes(s.mgr.db, info.UserID, "cpu")
	gpuFreeMin, _ := remainingFreeMinutes(s.mgr.db, info.UserID, "gpu")

	return connect.NewResponse(&apiv1.GetProfileResponse{
		UserId:      info.UserID,
		Email:       email,
		Name:        name,
		StageCount:  int32(stageCount),
		ApiKeyCount: int32(apiKeyCount),
		Plan:        plan,
		Limits: &apiv1.PlanLimits{
			MaxStages:              int32(cfg.MaxStages),
			MaxActiveCpuStages:     int32(cfg.MaxActiveStages),
			MaxActiveGpuStages:     int32(cfg.MaxActiveStages),
			MaxExternalDestinations: int32(cfg.MaxExternalDest),
			IncludedCpuHours:       int32(ceilToHours(cpuFreeMin)),
			IncludedGpuHours:       int32(ceilToHours(gpuFreeMin)),
			CanUsePrivate:          cfg.CanPrivate,
		},
		Usage: &apiv1.UsageSummary{
			CpuHoursUsed:     int32(cpuHrs),
			GpuHoursUsed:     int32(gpuHrs),
			CpuHoursIncluded: int32(ceilToHours(cpuFreeMin)),
			GpuHoursIncluded: int32(ceilToHours(gpuFreeMin)),
		},
	}), nil
}
