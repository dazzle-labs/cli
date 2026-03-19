package main

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"connectrpc.com/connect"
	"github.com/google/uuid"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
)

// stageServer implements apiv1connect.StageServiceHandler.
type stageServer struct {
	mgr *Manager
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
	info := mustAuth(ctx)

	row, err := dbGetStage(s.mgr.db, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if row == nil || row.UserID != info.UserID {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}

	st := stageRowToStruct(row, s.mgr)
	return connect.NewResponse(&apiv1.GetStageResponse{
		Stage: stageToProto(st, s.mgr.publicBaseURL, s.mgr.db),
	}), nil
}

func (s *stageServer) DeleteStage(ctx context.Context, req *connect.Request[apiv1.DeleteStageRequest]) (*connect.Response[apiv1.DeleteStageResponse], error) {
	info := mustAuth(ctx)

	row, err := dbGetStage(s.mgr.db, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if row == nil || row.UserID != info.UserID {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}

	// Capture pod info before deletion (needed for wait)
	var podName string
	if live, ok := s.mgr.getStage(req.Msg.Id); ok {
		podName = live.PodName
	}

	// Stop pod if active
	s.mgr.deleteStage(req.Msg.Id)

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
		prefix := "users/" + info.UserID + "/stages/" + req.Msg.Id + "/"
		if err := s.mgr.r2Client.DeletePrefix(cleanupCtx, prefix); err != nil {
			log.Printf("WARN: r2 cleanup for stage %s: %v", req.Msg.Id, err)
		}
	}

	// Remove DB record
	if err := dbDeleteStage(s.mgr.db, req.Msg.Id, info.UserID); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.DeleteStageResponse{}), nil
}

func (s *stageServer) SetStageDestination(ctx context.Context, req *connect.Request[apiv1.SetStageDestinationRequest]) (*connect.Response[apiv1.SetStageDestinationResponse], error) {
	info := mustAuth(ctx)

	row, err := dbGetStage(s.mgr.db, req.Msg.StageId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if row == nil || row.UserID != info.UserID {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("stage not found"))
	}

	if req.Msg.DestinationId != "" {
		dest, err := dbGetStreamDestForUser(s.mgr.db, req.Msg.DestinationId, info.UserID)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		if dest == nil {
			return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("destination not found"))
		}
	}

	if err := dbSetStageDestination(s.mgr.db, req.Msg.StageId, info.UserID, req.Msg.DestinationId); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	updated, err := dbGetStage(s.mgr.db, req.Msg.StageId)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	st := stageRowToStruct(updated, s.mgr)
	return connect.NewResponse(&apiv1.SetStageDestinationResponse{
		Stage: stageToProto(st, s.mgr.publicBaseURL, s.mgr.db),
	}), nil
}

func (s *stageServer) ActivateStage(ctx context.Context, req *connect.Request[apiv1.ActivateStageRequest]) (*connect.Response[apiv1.ActivateStageResponse], error) {
	info := mustAuth(ctx)

	row, err := dbGetStage(s.mgr.db, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if row == nil || row.UserID != info.UserID {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}

	// Check not already active
	if live, ok := s.mgr.getStage(req.Msg.Id); ok && live.Status == StatusRunning {
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
		readyStage, err = s.mgr.activateGPUStage(waitCtx, req.Msg.Id, info.UserID)
	} else {
		readyStage, err = s.mgr.activateStage(waitCtx, req.Msg.Id, info.UserID)
	}
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Populate fields from DB that the in-memory stage doesn't track
	readyStage.Name = row.Name
	if freshRow, err := dbGetStage(s.mgr.db, req.Msg.Id); err == nil && freshRow != nil && freshRow.PreviewToken.Valid && freshRow.PreviewToken.String != "" {
		readyStage.PreviewToken = freshRow.PreviewToken.String
	}

	return connect.NewResponse(&apiv1.ActivateStageResponse{
		Stage: stageToProto(readyStage, s.mgr.publicBaseURL, s.mgr.db),
	}), nil
}

func (s *stageServer) DeactivateStage(ctx context.Context, req *connect.Request[apiv1.DeactivateStageRequest]) (*connect.Response[apiv1.DeactivateStageResponse], error) {
	info := mustAuth(ctx)

	row, err := dbGetStage(s.mgr.db, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if row == nil || row.UserID != info.UserID {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}

	if err := s.mgr.deactivateStage(req.Msg.Id); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Return the stage from DB (now inactive)
	updated, _ := dbGetStage(s.mgr.db, req.Msg.Id)
	if updated == nil {
		return connect.NewResponse(&apiv1.DeactivateStageResponse{}), nil
	}
	st := stageRowToStruct(updated, s.mgr)
	return connect.NewResponse(&apiv1.DeactivateStageResponse{
		Stage: stageToProto(st, s.mgr.publicBaseURL, s.mgr.db),
	}), nil
}

func (s *stageServer) UpdateStage(ctx context.Context, req *connect.Request[apiv1.UpdateStageRequest]) (*connect.Response[apiv1.UpdateStageResponse], error) {
	info := mustAuth(ctx)

	if req.Msg.Stage == nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("stage is required"))
	}
	if req.Msg.UpdateMask == nil || len(req.Msg.UpdateMask.Paths) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("update_mask is required"))
	}

	for _, path := range req.Msg.UpdateMask.Paths {
		switch path {
		case "name":
			if req.Msg.Stage.Name == "" {
				return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("name cannot be empty"))
			}
			if _, err := dbRenameStage(s.mgr.db, req.Msg.Stage.Id, info.UserID, req.Msg.Stage.Name); err != nil {
				return nil, connect.NewError(connect.CodeNotFound, err)
			}
		default:
			return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("unsupported update path: %s", path))
		}
	}

	row, err := dbGetStage(s.mgr.db, req.Msg.Stage.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if row == nil || row.UserID != info.UserID {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("stage not found"))
	}

	st := stageRowToStruct(row, s.mgr)
	return connect.NewResponse(&apiv1.UpdateStageResponse{
		Stage: stageToProto(st, s.mgr.publicBaseURL, s.mgr.db),
	}), nil
}

func (s *stageServer) RegeneratePreviewToken(ctx context.Context, req *connect.Request[apiv1.RegeneratePreviewTokenRequest]) (*connect.Response[apiv1.RegeneratePreviewTokenResponse], error) {
	info := mustAuth(ctx)

	row, err := dbGetStage(s.mgr.db, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if row == nil || row.UserID != info.UserID {
		return nil, connect.NewError(connect.CodeNotFound, nil)
	}

	newToken := "dpt_" + strings.ReplaceAll(uuid.NewString(), "-", "")
	if err := dbSetPreviewToken(s.mgr.db, req.Msg.Id, newToken); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Invalidate old token from cache
	if row.PreviewToken.Valid && row.PreviewToken.String != "" {
		s.mgr.invalidatePreviewToken(row.PreviewToken.String)
	}
	// Update live stage if active
	s.mgr.mu.Lock()
	if live, ok := s.mgr.stages[req.Msg.Id]; ok {
		live.PreviewToken = newToken
	}
	s.mgr.mu.Unlock()

	updated, err := dbGetStage(s.mgr.db, req.Msg.Id)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	st := stageRowToStruct(updated, s.mgr)
	return connect.NewResponse(&apiv1.RegeneratePreviewTokenResponse{
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
		ID:            row.ID,
		Name:          row.Name,
		PodName:       row.PodName.String,
		PodIP:         row.PodIP.String,
		CreatedAt:     row.CreatedAt,
		Status:        StageStatus(row.Status),
		OwnerUserID:   row.UserID,
		DestinationID: row.DestinationID.String,
		PreviewToken:  row.PreviewToken.String,
		Provider:      provider,
		SidecarURL:    row.SidecarURL.String,
		Capabilities:  row.Capabilities,
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
		DestinationId: s.DestinationID,
		Capabilities:  s.Capabilities,
	}
	if s.PreviewToken != "" && publicBaseURL != "" {
		pb.Preview = &apiv1.StagePreview{
			WatchUrl: publicBaseURL + "/stage/" + s.ID + "/preview?token=" + s.PreviewToken,
			HlsUrl:   publicBaseURL + "/stage/" + s.ID + "/hls/stream.m3u8?token=" + s.PreviewToken,
		}
	}
	if db != nil && s.DestinationID != "" && s.OwnerUserID != "" {
		if dest, err := dbGetStreamDestForUser(db, s.DestinationID, s.OwnerUserID); err == nil && dest != nil {
			pb.Destination = &apiv1.StreamDestination{
				Id:               dest.ID,
				Name:             dest.Name,
				Platform:         dest.Platform,
				PlatformUsername: dest.PlatformUsername,
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
