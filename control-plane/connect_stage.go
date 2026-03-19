package main

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"
	"time"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
)

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
func requireStage(ctx context.Context, mgr *Manager, idOrSlug string) (authInfo, *stageRow, error) {
	info := mustAuth(ctx)
	if id, err := resolveStageID(mgr, idOrSlug); err == nil {
		idOrSlug = id
	}
	row, err := dbGetStage(mgr.db, idOrSlug)
	if err != nil {
		return info, nil, connect.NewError(connect.CodeInternal, err)
	}
	if row == nil || row.UserID != info.UserID {
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

	// Enforce per-user total stage limit.
	existing, err := dbListStages(s.mgr.db, info.UserID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to check stage limits"))
	}
	if len(existing) >= 50 {
		return nil, connect.NewError(connect.CodeResourceExhausted, fmt.Errorf("stage limit reached (max 50)"))
	}

	stage, err := s.mgr.createStageRecord(info.UserID, name, req.Msg.Capabilities)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create stage"))
	}

	return connect.NewResponse(&apiv1.CreateStageResponse{
		Stage: stageToProto(stage, s.mgr.publicBaseURL, s.mgr.db),
	}), nil
}

func (s *stageServer) ListStages(ctx context.Context, req *connect.Request[apiv1.ListStagesRequest]) (*connect.Response[apiv1.ListStagesResponse], error) {
	info := mustAuth(ctx)

	rows, err := dbListStages(s.mgr.db, info.UserID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	var pbStages []*apiv1.Stage
	for _, row := range rows {
		st := stageRowToStruct(&row, s.mgr)
		pbStages = append(pbStages, stageToProto(st, s.mgr.publicBaseURL, s.mgr.db))
	}
	return connect.NewResponse(&apiv1.ListStagesResponse{
		Stages: pbStages,
	}), nil
}

func (s *stageServer) GetStage(ctx context.Context, req *connect.Request[apiv1.GetStageRequest]) (*connect.Response[apiv1.GetStageResponse], error) {
	_, row, err := requireStage(ctx, s.mgr, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	st := stageRowToStruct(row, s.mgr)
	return connect.NewResponse(&apiv1.GetStageResponse{
		Stage: stageToProto(st, s.mgr.publicBaseURL, s.mgr.db),
	}), nil
}

func (s *stageServer) DeleteStage(ctx context.Context, req *connect.Request[apiv1.DeleteStageRequest]) (*connect.Response[apiv1.DeleteStageResponse], error) {
	info, row, err := requireStage(ctx, s.mgr, req.Msg.Id)
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

	// Best-effort R2 cleanup
	if s.mgr.r2Client != nil {
		prefix := "users/" + info.UserID + "/stages/" + stageID + "/"
		if err := s.mgr.r2Client.DeletePrefix(cleanupCtx, prefix); err != nil {
			log.Printf("WARN: r2 cleanup for stage %s: %v", stageID, err)
		}
	}

	// Remove DB record
	if err := dbDeleteStage(s.mgr.db, stageID, info.UserID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.DeleteStageResponse{}), nil
}

func (s *stageServer) SetStageDestination(ctx context.Context, req *connect.Request[apiv1.SetStageDestinationRequest]) (*connect.Response[apiv1.SetStageDestinationResponse], error) {
	info, row, err := requireStage(ctx, s.mgr, req.Msg.StageId)
	if err != nil {
		return nil, err
	}
	stageID := row.ID

	if req.Msg.DestinationId != "" {
		dest, err := dbGetStreamDestForUser(s.mgr.db, req.Msg.DestinationId, info.UserID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		if dest == nil {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("destination not found"))
		}
		if _, err := dbAddStageDestination(s.mgr.db, stageID, req.Msg.DestinationId); err != nil {
			if errors.Is(err, errMaxDestinations) {
				return nil, connect.NewError(connect.CodeResourceExhausted, err)
			}
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	// Sync pipeline outputs if stage is running
	s.mgr.syncStageOutputsIfRunning(stageID, info.UserID)

	updated, err := dbGetStage(s.mgr.db, stageID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	st := stageRowToStruct(updated, s.mgr)
	return connect.NewResponse(&apiv1.SetStageDestinationResponse{
		Stage: stageToProto(st, s.mgr.publicBaseURL, s.mgr.db),
	}), nil
}

func (s *stageServer) RemoveStageDestination(ctx context.Context, req *connect.Request[apiv1.RemoveStageDestinationRequest]) (*connect.Response[apiv1.RemoveStageDestinationResponse], error) {
	info, row, err := requireStage(ctx, s.mgr, req.Msg.StageId)
	if err != nil {
		return nil, err
	}
	stageID := row.ID

	// Dazzle destinations can't be removed — disable instead
	if dest, err := dbGetStreamDestForUser(s.mgr.db, req.Msg.DestinationId, info.UserID); err == nil && dest != nil && dest.Platform == "dazzle" {
		if err := dbSetStageDestinationEnabled(s.mgr.db, stageID, req.Msg.DestinationId, false); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	} else {
		if err := dbRemoveStageDestination(s.mgr.db, stageID, req.Msg.DestinationId); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
	}

	// Sync pipeline outputs if stage is running
	s.mgr.syncStageOutputsIfRunning(stageID, info.UserID)

	updated, err := dbGetStage(s.mgr.db, stageID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	st := stageRowToStruct(updated, s.mgr)
	return connect.NewResponse(&apiv1.RemoveStageDestinationResponse{
		Stage: stageToProto(st, s.mgr.publicBaseURL, s.mgr.db),
	}), nil
}

func (s *stageServer) ActivateStage(ctx context.Context, req *connect.Request[apiv1.ActivateStageRequest]) (*connect.Response[apiv1.ActivateStageResponse], error) {
	info, row, err := requireStage(ctx, s.mgr, req.Msg.Id)
	if err != nil {
		return nil, err
	}
	stageID := row.ID

	// Check not already active
	if live, ok := s.mgr.getStage(stageID); ok && live.Status == StatusRunning {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("stage is already active"))
	}

	// Enforce per-user active stage limits: 3 total, 1 GPU.
	allStages, listErr := dbListStages(s.mgr.db, info.UserID)
	if listErr != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to check stage limits"))
	}
	activeCount, activeGPU := 0, 0
	for _, st := range allStages {
		if st.Status == "running" || st.Status == "starting" {
			activeCount++
			if hasCapability(st.Capabilities, "gpu") {
				activeGPU++
			}
		}
	}
	if activeCount >= 3 {
		return nil, connect.NewError(connect.CodeResourceExhausted, fmt.Errorf("active stage limit reached (max 3)"))
	}
	if hasCapability(row.Capabilities, "gpu") && activeGPU >= 1 {
		return nil, connect.NewError(connect.CodeResourceExhausted, fmt.Errorf("active GPU stage limit reached (max 1)"))
	}

	waitCtx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	// Branch on capabilities: GPU stages use RunPod agent, others use k8s pods
	var readyStage *Stage
	if hasCapability(row.Capabilities, "gpu") {
		readyStage, err = s.mgr.activateGPUStage(waitCtx, stageID, info.UserID)
	} else {
		readyStage, err = s.mgr.activateStage(waitCtx, stageID, info.UserID)
	}
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Populate fields from DB that the in-memory stage doesn't track
	readyStage.Name = row.Name
	if freshRow, err := dbGetStage(s.mgr.db, stageID); err == nil && freshRow != nil {
		if freshRow.PreviewToken.Valid {
			readyStage.PreviewToken = freshRow.PreviewToken.String
		}
		if freshRow.Slug.Valid {
			readyStage.Slug = freshRow.Slug.String
		}
	}

	return connect.NewResponse(&apiv1.ActivateStageResponse{
		Stage: stageToProto(readyStage, s.mgr.publicBaseURL, s.mgr.db),
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

	info, row, err := requireStage(ctx, s.mgr, req.Msg.Stage.Id)
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
			if _, err := dbRenameStage(s.mgr.db, stageID, info.UserID, req.Msg.Stage.Name); err != nil {
				return nil, connect.NewError(connect.CodeNotFound, err)
			}
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
	}
	// Watch URL (replaces the old StagePreview)
	if publicBaseURL != "" && s.Slug != "" {
		pb.WatchUrl = publicBaseURL + "/watch/" + s.Slug
	}
	// Populate destinations list from stage_destinations join table.
	if db != nil && s.OwnerUserID != "" {
		if dests, err := dbListStageDestinations(db, s.ID); err == nil {
			for _, sd := range dests {
				pb.Destinations = append(pb.Destinations, &apiv1.StageDestination{
					Id:               sd.ID,
					DestinationId:    sd.DestinationID,
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
