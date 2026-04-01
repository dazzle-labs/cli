package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"os"
	"strings"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
)

var adminUserIDs = func() map[string]bool {
	m := make(map[string]bool)
	for _, id := range strings.Split(os.Getenv("ADMIN_USER_IDS"), ",") {
		if id = strings.TrimSpace(id); id != "" {
			m[id] = true
		}
	}
	return m
}()

func isAdmin(userID string) bool { return adminUserIDs[userID] }

// resolveStageID resolves a slug or UUID to a stage UUID.
// UUIDs (36 chars with dashes) pass through unchanged; anything else is
// treated as a slug and looked up via cache, then database.
func resolveStageID(mgr *Manager, idOrSlug string) (string, error) {
	if len(idOrSlug) == 36 && strings.Contains(idOrSlug, "-") {
		return idOrSlug, nil
	}
	if id, ok := mgr.slugCache.Get(idOrSlug); ok {
		return id, nil
	}
	row, err := dbLookupStageBySlug(mgr.db, idOrSlug)
	if err != nil {
		return "", err
	}
	if row == nil {
		return "", fmt.Errorf("stage not found")
	}
	mgr.slugCache.Add(idOrSlug, row.ID)
	return row.ID, nil
}

// stageServer implements apiv1connect.StageServiceHandler.
type stageServer struct {
	mgr *Manager
}

// requireStage resolves slug/UUID, authenticates, and verifies ownership in one call.
// Admin users (ADMIN_USER_IDS env var) can access any stage.
func requireStage(ctx context.Context, mgr *Manager, idOrSlug string) (authInfo, *stageRow, error) {
	info := mustAuth(ctx)
	if idOrSlug == "" {
		return info, nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("stage ID is required"))
	}
	if id, err := resolveStageID(mgr, idOrSlug); err == nil {
		idOrSlug = id
	}
	row, err := dbGetStage(mgr.db, idOrSlug)
	if err != nil {
		return info, nil, connect.NewError(connect.CodeInternal, err)
	}
	if row == nil {
		return info, nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("stage not found"))
	}
	if row.UserID != info.UserID && !isAdmin(info.UserID) {
		return info, nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("stage not found"))
	}
	return info, row, nil
}

func (s *stageServer) CreateStage(ctx context.Context, req *connect.Request[apiv1.CreateStageRequest]) (*connect.Response[apiv1.CreateStageResponse], error) {
	info := mustAuth(ctx)

	name := req.Msg.Name
	if name == "" {
		name = "default"
	}
	if err := validateName(name); err != nil {
		return nil, err
	}

	// Look up plan and enforce limits
	plan := dbGetUserPlan(s.mgr.db, info.UserID)
	cfg := getPlanConfig(plan)

	// Enforce per-user total stage limit (created, regardless of state).
	maxStages := cfg.MaxStages
	if s.mgr.db != nil {
		var userMax int
		if err := s.mgr.db.QueryRow("SELECT max_stages FROM users WHERE id=$1", info.UserID).Scan(&userMax); err == nil && userMax > 0 {
			maxStages = userMax
		}
	}
	existing, err := dbListStages(s.mgr.db, info.UserID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to check stage limits"))
	}
	if len(existing) >= maxStages {
		return nil, connect.NewError(connect.CodeResourceExhausted, fmt.Errorf("stage limit reached (max %d)", maxStages))
	}

	// Validate visibility against plan
	visibility := req.Msg.Visibility
	if visibility == "" {
		visibility = VisibilityPublic
	}
	if visibility == VisibilityPrivate && !cfg.CanPrivate {
		return nil, connect.NewError(connect.CodePermissionDenied, fmt.Errorf("private stages require Pro plan"))
	}
	if visibility != VisibilityPublic && visibility != VisibilityPrivate {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("visibility must be 'public' or 'private'"))
	}

	// Resolution is hardcoded to 720p for now — 1080p support will come later
	resolution := Resolution720p

	stage, err := s.mgr.createStageRecord(info.UserID, name, req.Msg.Capabilities, visibility, resolution)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create stage"))
	}

	return connect.NewResponse(&apiv1.CreateStageResponse{
		Stage: stageToProto(stage, s.mgr.publicBaseURL, s.mgr.db),
	}), nil
}

func (s *stageServer) ListStages(ctx context.Context, req *connect.Request[apiv1.ListStagesRequest]) (*connect.Response[apiv1.ListStagesResponse], error) {
	filters := req.Msg.Filters
	info, authed := authInfoFromCtx(ctx)

	// Parse filter set
	wantLive := false
	wantOwned := false
	for _, f := range filters {
		switch f {
		case apiv1.StageFilter_STAGE_FILTER_LIVE:
			wantLive = true
		case apiv1.StageFilter_STAGE_FILTER_OWNED:
			wantOwned = true
		}
	}
	// Default (no filters): owned stages for backward compat
	if !wantLive && !wantOwned {
		wantOwned = true
	}

	if wantOwned && !authed {
		return nil, connect.NewError(connect.CodeUnauthenticated, fmt.Errorf("authentication required for owned stages"))
	}

	if wantLive && !wantOwned {
		// Public: list live stages with limited fields
		rows, err := dbListLiveStages(s.mgr.db)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		var pbStages []*apiv1.Stage
		for _, row := range rows {
			pb := &apiv1.Stage{
				Name:   row.Name,
				Status: "running",
				Slug:   row.Slug.String,
			}
			if row.StreamTitle.Valid && row.StreamTitle.String != "" {
				pb.Name = row.StreamTitle.String
			}
			if s.mgr.publicBaseURL != "" && row.Slug.Valid {
				pb.WatchUrl = s.mgr.publicBaseURL + "/watch/" + row.Slug.String
			}
			pbStages = append(pbStages, pb)
		}
		return connect.NewResponse(&apiv1.ListStagesResponse{Stages: pbStages}), nil
	}

	// Owned (possibly filtered to live). Admins see all stages.
	var rows []stageRow
	var err error
	if isAdmin(info.UserID) {
		rows, err = dbListAllStages(s.mgr.db)
	} else {
		rows, err = dbListStages(s.mgr.db, info.UserID)
	}
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var pbStages []*apiv1.Stage
	for _, row := range rows {
		if wantLive {
			// Filter to only stages with active RTMP sessions
			if !dbStageIsLive(s.mgr.db, row.ID) {
				continue
			}
		}
		st := stageRowToStruct(&row, s.mgr)
		pbStages = append(pbStages, stageToProto(st, s.mgr.publicBaseURL, s.mgr.db))
	}
	return connect.NewResponse(&apiv1.ListStagesResponse{Stages: pbStages}), nil
}

func (s *stageServer) GetStage(ctx context.Context, req *connect.Request[apiv1.GetStageRequest]) (*connect.Response[apiv1.GetStageResponse], error) {
	idOrSlug := req.Msg.Id
	if id, err := resolveStageID(s.mgr, idOrSlug); err == nil {
		idOrSlug = id
	}
	row, err := dbGetStage(s.mgr.db, idOrSlug)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if row == nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("stage not found"))
	}

	// Owner gets full info
	if info, ok := authInfoFromCtx(ctx); ok && info.UserID == row.UserID {
		st := stageRowToStruct(row, s.mgr)
		return connect.NewResponse(&apiv1.GetStageResponse{
			Stage: stageToProto(st, s.mgr.publicBaseURL, s.mgr.db),
		}), nil
	}

	// Everyone else gets public info
	pb := &apiv1.Stage{
		Name:   row.Name,
		Status: row.Status,
		Slug:   row.Slug.String,
	}
	if row.StreamTitle.Valid && row.StreamTitle.String != "" {
		pb.Name = row.StreamTitle.String
	}
	if s.mgr.publicBaseURL != "" && row.Slug.Valid {
		pb.WatchUrl = s.mgr.publicBaseURL + "/watch/" + row.Slug.String
	}
	return connect.NewResponse(&apiv1.GetStageResponse{Stage: pb}), nil
}

func (s *stageServer) DeleteStage(ctx context.Context, req *connect.Request[apiv1.DeleteStageRequest]) (*connect.Response[apiv1.DeleteStageResponse], error) {
	_, row, err := requireStage(ctx, s.mgr, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	stageID := row.ID

	// Capture pod info before deletion (needed for wait)
	var podName string
	if live, ok := s.mgr.getStage(stageID); ok {
		podName = live.PodName
	}

	// Stop pod if active
	s.mgr.deleteStage(stageID)

	// Use background context so client cancellation doesn't skip cleanup
	cleanupCtx, cleanupCancel := context.WithTimeout(context.Background(), 45*time.Second)
	defer cleanupCancel()

	// Wait for pod termination (ensures sidecar final sync completes)
	// Skip for GPU stages — they don't have local k8s pods
	if podName != "" && !hasCapability(row.Capabilities, "gpu") {
		waitForPodTermination(cleanupCtx, s.mgr.clientset, s.mgr.namespace, podName, 35*time.Second)
	}

	// Close any open usage events before deleting the stage record
	if err := recordStageDeactivation(s.mgr.db, stageID); err != nil {
		log.Printf("WARN: close usage event for deleted stage %s: %v", stageID, err)
	}

	// Best-effort R2 cleanup
	if s.mgr.r2Client != nil {
		prefix := "users/" + row.UserID + "/stages/" + stageID + "/"
		if err := s.mgr.r2Client.DeletePrefix(cleanupCtx, prefix); err != nil {
			log.Printf("WARN: r2 cleanup for stage %s: %v", stageID, err)
		}
	}

	// Remove DB record
	if err := dbDeleteStage(s.mgr.db, stageID, row.UserID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.DeleteStageResponse{}), nil
}

func (s *stageServer) AttachStageDestination(ctx context.Context, req *connect.Request[apiv1.AttachStageDestinationRequest]) (*connect.Response[apiv1.AttachStageDestinationResponse], error) {
	_, row, err := requireStage(ctx, s.mgr, req.Msg.StageId)
	if err != nil {
		return nil, err
	}
	stageID := row.ID

	if req.Msg.DestinationId != "" {
		dest, err := dbGetStreamDestForUser(s.mgr.db, req.Msg.DestinationId, row.UserID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		if dest == nil {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("destination not found"))
		}
		plan := dbGetUserPlan(s.mgr.db, row.UserID)
		maxDest := getPlanConfig(plan).MaxExternalDest
		if _, err := dbAddStageDestination(s.mgr.db, stageID, req.Msg.DestinationId, maxDest); err != nil {
			if errors.Is(err, errMaxDestinations) {
				return nil, connect.NewError(connect.CodeResourceExhausted, err)
			}
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	// Sync pipeline outputs if stage is running
	s.mgr.syncStageOutputsIfRunning(stageID, row.UserID)

	updated, err := dbGetStage(s.mgr.db, stageID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	st := stageRowToStruct(updated, s.mgr)
	return connect.NewResponse(&apiv1.AttachStageDestinationResponse{
		Stage: stageToProto(st, s.mgr.publicBaseURL, s.mgr.db),
	}), nil
}

func (s *stageServer) DetachStageDestination(ctx context.Context, req *connect.Request[apiv1.DetachStageDestinationRequest]) (*connect.Response[apiv1.DetachStageDestinationResponse], error) {
	_, row, err := requireStage(ctx, s.mgr, req.Msg.StageId)
	if err != nil {
		return nil, err
	}
	stageID := row.ID

	// Dazzle destinations can't be removed — disable instead
	if dest, err := dbGetStreamDestForUser(s.mgr.db, req.Msg.DestinationId, row.UserID); err == nil && dest != nil && dest.Platform == "dazzle" {
		if err := dbSetStageDestinationEnabled(s.mgr.db, stageID, req.Msg.DestinationId, false); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	} else {
		if err := dbRemoveStageDestination(s.mgr.db, stageID, req.Msg.DestinationId); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	// Sync pipeline outputs if stage is running
	s.mgr.syncStageOutputsIfRunning(stageID, row.UserID)

	updated, err := dbGetStage(s.mgr.db, stageID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	st := stageRowToStruct(updated, s.mgr)
	return connect.NewResponse(&apiv1.DetachStageDestinationResponse{
		Stage: stageToProto(st, s.mgr.publicBaseURL, s.mgr.db),
	}), nil
}

// Deprecated: delegates to AttachStageDestination.
func (s *stageServer) SetStageDestination(ctx context.Context, req *connect.Request[apiv1.SetStageDestinationRequest]) (*connect.Response[apiv1.SetStageDestinationResponse], error) {
	attachReq := connect.NewRequest(&apiv1.AttachStageDestinationRequest{
		StageId:       req.Msg.StageId,
		DestinationId: req.Msg.DestinationId,
	})
	attachReq.Header().Set("Authorization", req.Header().Get("Authorization"))
	resp, err := s.AttachStageDestination(ctx, attachReq)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&apiv1.SetStageDestinationResponse{
		Stage: resp.Msg.Stage,
	}), nil
}

// Deprecated: delegates to DetachStageDestination.
func (s *stageServer) RemoveStageDestination(ctx context.Context, req *connect.Request[apiv1.RemoveStageDestinationRequest]) (*connect.Response[apiv1.RemoveStageDestinationResponse], error) {
	detachReq := connect.NewRequest(&apiv1.DetachStageDestinationRequest{
		StageId:       req.Msg.StageId,
		DestinationId: req.Msg.DestinationId,
	})
	detachReq.Header().Set("Authorization", req.Header().Get("Authorization"))
	resp, err := s.DetachStageDestination(ctx, detachReq)
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&apiv1.RemoveStageDestinationResponse{
		Stage: resp.Msg.Stage,
	}), nil
}

func (s *stageServer) ActivateStage(ctx context.Context, req *connect.Request[apiv1.ActivateStageRequest]) (*connect.Response[apiv1.ActivateStageResponse], error) {
	_, row, err := requireStage(ctx, s.mgr, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	stageID := row.ID
	isGPU := hasCapability(row.Capabilities, "gpu")

	// Per-stage lock: prevents concurrent activate/deactivate from racing.
	// Hold through the check + DB update + goroutine launch so two concurrent
	// ActivateStage calls can't both pass the "already running" check.
	stageUnlock, lockErr := s.mgr.lockStage(ctx, stageID)
	if lockErr != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("acquire stage lock: %w", lockErr))
	}

	// Already running or starting — return current state
	if live, ok := s.mgr.getStage(stageID); ok {
		if live.Status == StatusRunning || live.Status == StatusStarting {
			stageUnlock()
			st := stageRowToStruct(row, s.mgr)
			return connect.NewResponse(&apiv1.ActivateStageResponse{
				Stage: stageToProto(st, s.mgr.publicBaseURL, s.mgr.db),
			}), nil
		}
	}

	// Also check DB status — covers recovered GPU stages not yet in memory
	if row.Status == "running" || row.Status == "starting" {
		stageUnlock()
		st := stageRowToStruct(row, s.mgr)
		return connect.NewResponse(&apiv1.ActivateStageResponse{
			Stage: stageToProto(st, s.mgr.publicBaseURL, s.mgr.db),
		}), nil
	}

	// Enforce per-user active stage limits from DB / plan config.
	// Use the stage owner's limits, not the caller's (relevant for admin bypass).
	info := mustAuth(ctx)
	ownerID := row.UserID
	plan := dbGetUserPlan(s.mgr.db, ownerID)
	cfg := getPlanConfig(plan)

	maxActiveCPU := cfg.MaxActiveStages
	maxActiveGPU := 1
	if s.mgr.db != nil {
		var cpuLimit, gpuLimit int
		if err := s.mgr.db.QueryRow("SELECT max_active_cpu_stages, max_active_gpu_stages FROM users WHERE id=$1", ownerID).Scan(&cpuLimit, &gpuLimit); err == nil {
			maxActiveCPU = cpuLimit
			maxActiveGPU = gpuLimit
		}
	}
	allStages, listErr := dbListStages(s.mgr.db, ownerID)
	if listErr != nil {
		stageUnlock()
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to check stage limits"))
	}
	activeCPU, activeGPU := 0, 0
	for _, st := range allStages {
		if st.Status == "running" || st.Status == "starting" {
			if hasCapability(st.Capabilities, "gpu") {
				activeGPU++
			} else {
				activeCPU++
			}
		}
	}
	if isGPU && activeGPU >= maxActiveGPU {
		stageUnlock()
		return nil, connect.NewError(connect.CodeResourceExhausted, fmt.Errorf("active GPU stage limit reached (max %d)", maxActiveGPU))
	}
	if !isGPU && activeCPU >= maxActiveCPU {
		stageUnlock()
		return nil, connect.NewError(connect.CodeResourceExhausted, fmt.Errorf("active CPU stage limit reached (max %d)", maxActiveCPU))
	}

	// Acquire per-user budget lock to serialize usage checks + recording across
	// concurrent activations of different stages by the same user. This prevents
	// two activations from both passing the spending cap before either records.
	budgetUnlock, budgetErr := s.mgr.lockBudget(ctx, info.UserID)
	if budgetErr != nil {
		stageUnlock()
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("acquire budget lock: %w", budgetErr))
	}

	// Enforce usage grants — check if user has available minutes for this resource.
	resource := "cpu"
	if isGPU {
		resource = "gpu"
	}

	freeMin, _ := remainingFreeMinutes(s.mgr.db, info.UserID, resource)
	if freeMin <= 0 {
		// No free minutes — check if they have a metered grant (PAYG)
		hasMetered, _ := hasActiveGrant(s.mgr.db, info.UserID, resource)
		if !hasMetered {
			budgetUnlock()
			stageUnlock()
			return nil, connect.NewError(connect.CodeResourceExhausted,
				fmt.Errorf("no available %s hours — upgrade your plan or add a payment method", resource))
		}
		if plan == PlanFree {
			budgetUnlock()
			stageUnlock()
			return nil, connect.NewError(connect.CodeResourceExhausted,
				fmt.Errorf("free tier %s hours exhausted — upgrade to continue", resource))
		}
		// Paid plan — check overage opt-in
		overageEnabled, overageLimitCents := dbGetOverageSettings(s.mgr.db, info.UserID)
		if !overageEnabled {
			budgetUnlock()
			stageUnlock()
			return nil, connect.NewError(connect.CodeResourceExhausted,
				fmt.Errorf("included hours exhausted — enable overage in billing settings to continue"))
		}
		// Check spending cap
		if overageLimitCents != nil {
			periodStart := currentPeriodStart(s.mgr.db, info.UserID)
			cpuSpent, _ := meteredSpendCents(s.mgr.db, info.UserID, "cpu", periodStart)
			gpuSpent, _ := meteredSpendCents(s.mgr.db, info.UserID, "gpu", periodStart)
			totalSpentCents := cpuSpent + gpuSpent
			if totalSpentCents >= *overageLimitCents {
				budgetUnlock()
				stageUnlock()
				return nil, connect.NewError(connect.CodeResourceExhausted,
					fmt.Errorf("overage spending cap reached ($%.2f / $%.2f)", float64(totalSpentCents)/100, float64(*overageLimitCents)/100))
			}
		}
	}

	// Set DB status to starting before spawning goroutine so GetStage reflects it immediately
	dbUpdateStageStatus(s.mgr.db, stageID, "starting", "", "")

	// Record usage event now (optimistically) so concurrent activation requests
	// from the same user see this stage's hours in their budget check. If activation
	// fails, activateStageAsync will close the usage event via recordStageDeactivation.
	provider := "cpu"
	if isGPU {
		provider = "gpu"
	}
	if recErr := recordStageActivation(s.mgr.db, info.UserID, stageID, provider); recErr != nil {
		log.Printf("WARN: early record stage activation for %s: %v", stageID, recErr)
	}

	// Release user budget lock — the usage event is recorded, so concurrent
	// requests will now see this stage's hours in their budget check.
	budgetUnlock()

	// Activate asynchronously — return immediately with starting status.
	// Unlock after goroutine starts; the inner activateStage/activateGPUStage
	// re-acquires the per-stage lock for the actual provisioning.
	go s.mgr.activateStageAsync(stageID, ownerID, isGPU, row.Capabilities)
	stageUnlock()

	// Return stage in starting state
	st := stageRowToStruct(row, s.mgr)
	st.Status = StatusStarting
	return connect.NewResponse(&apiv1.ActivateStageResponse{
		Stage: stageToProto(st, s.mgr.publicBaseURL, s.mgr.db),
	}), nil
}

func (s *stageServer) DeactivateStage(ctx context.Context, req *connect.Request[apiv1.DeactivateStageRequest]) (*connect.Response[apiv1.DeactivateStageResponse], error) {
	_, row, err := requireStage(ctx, s.mgr, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	stageID := row.ID

	if err := s.mgr.deactivateStage(stageID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Return the stage from DB (now inactive)
	updated, _ := dbGetStage(s.mgr.db, stageID)
	if updated == nil {
		return connect.NewResponse(&apiv1.DeactivateStageResponse{}), nil
	}
	st := stageRowToStruct(updated, s.mgr)
	return connect.NewResponse(&apiv1.DeactivateStageResponse{
		Stage: stageToProto(st, s.mgr.publicBaseURL, s.mgr.db),
	}), nil
}

func (s *stageServer) UpdateStage(ctx context.Context, req *connect.Request[apiv1.UpdateStageRequest]) (*connect.Response[apiv1.UpdateStageResponse], error) {
	if req.Msg.Stage == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("stage is required"))
	}
	if req.Msg.UpdateMask == nil || len(req.Msg.UpdateMask.Paths) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("update_mask is required"))
	}

	_, row, err := requireStage(ctx, s.mgr, req.Msg.Stage.Id)
	if err != nil {
		return nil, err
	}
	stageID := row.ID

	for _, path := range req.Msg.UpdateMask.Paths {
		switch path {
		case "name":
			if req.Msg.Stage.Name == "" {
				return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name cannot be empty"))
			}
			if err := validateName(req.Msg.Stage.Name); err != nil {
				return nil, err
			}
			if _, err := dbRenameStage(s.mgr.db, stageID, row.UserID, req.Msg.Stage.Name); err != nil {
				return nil, connect.NewError(connect.CodeNotFound, err)
			}
		case "slug":
			slug := req.Msg.Stage.Slug
			if slug == "" {
				return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("slug cannot be empty"))
			}
			if err := validateSlug(slug); err != nil {
				return nil, err
			}
			if err := dbUpdateSlug(s.mgr.db, stageID, row.UserID, slug); err != nil {
				if errors.Is(err, errSlugTaken) {
					return nil, connect.NewError(connect.CodeAlreadyExists, err)
				}
				return nil, connect.NewError(connect.CodeInternal, err)
			}
			// Invalidate slug cache so old slug stops resolving
			s.mgr.slugCache.Remove(row.Slug.String)
			s.mgr.slugCache.Add(slug, stageID)
		default:
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("unsupported update path: %s", path))
		}
	}

	updated, err := dbGetStage(s.mgr.db, stageID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	st := stageRowToStruct(updated, s.mgr)
	return connect.NewResponse(&apiv1.UpdateStageResponse{
		Stage: stageToProto(st, s.mgr.publicBaseURL, s.mgr.db),
	}), nil
}

// stageRowToStruct merges a DB row with in-memory live state (pod IP, running status).
func stageRowToStruct(row *stageRow, mgr *Manager) *Stage {
	provider := row.Provider
	if provider == "" {
		provider = "kubernetes"
	}
	st := &Stage{
		ID:           row.ID,
		Name:         row.Name,
		PodName:      row.PodName.String,
		PodIP:        row.PodIP.String,
		CreatedAt:    row.CreatedAt,
		Status:       StageStatus(row.Status),
		OwnerUserID:  row.UserID,
		PreviewToken: row.PreviewToken.String,
		Provider:     provider,
		SidecarURL:   row.SidecarURL.String,
		Capabilities: row.Capabilities,
		Slug:         row.Slug.String,
		Visibility:   row.Visibility,
		Resolution:   row.Resolution,
	}
	// Overlay live in-memory state (more up-to-date pod IP, current status)
	if live, ok := mgr.getStage(row.ID); ok {
		st.PodIP = live.PodIP
		st.Status = live.Status
		st.PodName = live.PodName
	}
	return st
}

func stageToProto(s *Stage, publicBaseURL string, db *sql.DB) *apiv1.Stage {
	pb := &apiv1.Stage{
		Id:            s.ID,
		Name:          s.Name,
		PodName:       s.PodName,
		PodIp:         s.PodIP,
		DirectPort:    s.DirectPort,
		CreatedAt:     timestamppb.New(s.CreatedAt),
		Status:        string(s.Status),
		OwnerUserId:   s.OwnerUserID,
		Capabilities:  s.Capabilities,
		Slug:          s.Slug,
		Visibility:    s.Visibility,
		Resolution:    s.Resolution,
	}
	// Watch URL (replaces the old StagePreview)
	if publicBaseURL != "" && s.Slug != "" {
		pb.WatchUrl = publicBaseURL + "/watch/" + s.Slug
	}
	// Populate destinations list from stage_destinations join table.
	if db != nil && s.OwnerUserID != "" {
		if dests, err := dbListStageDestinations(db, s.ID); err == nil {
			for _, sd := range dests {
				pb.Destinations = append(pb.Destinations, &apiv1.StreamDestination{
					Id:               sd.DestinationID,
					Name:             sd.Name,
					Platform:         sd.Platform,
					PlatformUsername: sd.PlatformUsername,
					Enabled:          sd.Enabled,
				})
			}
		}
	}
	return pb
}

// hasCapability returns true if the capabilities list contains the given capability.
func hasCapability(caps []string, cap string) bool {
	for _, c := range caps {
		if c == cap {
			return true
		}
	}
	return false
}
