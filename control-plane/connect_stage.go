package main

import (
	"context"
	"fmt"

	"connectrpc.com/connect"
	"google.golang.org/protobuf/types/known/timestamppb"

	apiv1 "github.com/browser-streamer/control-plane/gen/api/v1"
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

// stageRowToStruct merges a DB row with in-memory live state (pod IP, running status).
func stageRowToStruct(row *stageRow, mgr *Manager) *Stage {
	st := &Stage{
		ID:          row.ID,
		Name:        row.Name,
		PodName:     row.PodName.String,
		PodIP:       row.PodIP.String,
		CreatedAt:   row.CreatedAt,
		Status:      StageStatus(row.Status),
		OwnerUserID: row.UserID,
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
		Id:          s.ID,
		Name:        s.Name,
		PodName:     s.PodName,
		PodIp:       s.PodIP,
		DirectPort:  s.DirectPort,
		CreatedAt:   timestamppb.New(s.CreatedAt),
		Status:      string(s.Status),
		OwnerUserId: s.OwnerUserID,
	}
}
