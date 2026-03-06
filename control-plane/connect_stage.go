package main

import (
	"context"
	"fmt"
	"log"
	"time"

	"connectrpc.com/connect"
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

	stage, err := s.mgr.createStageRecord(info.UserID, name)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("failed to create stage"))
	}

	return connect.NewResponse(&apiv1.CreateStageResponse{
		Stage: stageToProto(stage),
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
		pbStages = append(pbStages, stageToProto(st))
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
		Stage: stageToProto(st),
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

	// Stop pod if active
	s.mgr.deleteStage(req.Msg.Id)

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
		Stage: stageToProto(st),
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

	waitCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	readyStage, err := s.mgr.activateStage(waitCtx, req.Msg.Id, info.UserID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Restore script
	if s.mgr.db != nil {
		if script, err := dbGetStageScript(s.mgr.db, req.Msg.Id); err == nil && script != "" {
			if err := s.mgr.restoreScriptToPod(readyStage, script); err != nil {
				log.Printf("WARN: failed to restore script for stage %s: %v", req.Msg.Id, err)
			}
		}
	}

	// Configure OBS stream destination if set
	dest, destErr := s.mgr.validateStreamDestination(req.Msg.Id, info.UserID)
	if destErr == nil {
		if err := s.mgr.configureOBSStream(readyStage, dest); err != nil {
			log.Printf("Warning: failed to configure stream destination for stage %s: %v", req.Msg.Id, err)
		}
	}

	return connect.NewResponse(&apiv1.ActivateStageResponse{
		Stage: stageToProto(readyStage),
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
		Stage: stageToProto(st),
	}), nil
}

// stageRowToStruct merges a DB row with in-memory live state (pod IP, running status).
func stageRowToStruct(row *stageRow, mgr *Manager) *Stage {
	st := &Stage{
		ID:            row.ID,
		Name:          row.Name,
		PodName:       row.PodName.String,
		PodIP:         row.PodIP.String,
		CreatedAt:     row.CreatedAt,
		Status:        StageStatus(row.Status),
		OwnerUserID:   row.UserID,
		DestinationID: row.DestinationID.String,
	}
	// Overlay live in-memory state (more up-to-date pod IP, current status)
	if live, ok := mgr.getStage(row.ID); ok {
		st.PodIP = live.PodIP
		st.Status = live.Status
		st.PodName = live.PodName
	}
	return st
}

func stageToProto(s *Stage) *apiv1.Stage {
	return &apiv1.Stage{
		Id:            s.ID,
		Name:          s.Name,
		PodName:       s.PodName,
		PodIp:         s.PodIP,
		DirectPort:    s.DirectPort,
		CreatedAt:     timestamppb.New(s.CreatedAt),
		Status:        string(s.Status),
		OwnerUserId:   s.OwnerUserID,
		DestinationId: s.DestinationID,
	}
}
