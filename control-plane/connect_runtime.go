package main

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"time"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	apiv1connect "github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
)

// runtimeServer implements apiv1connect.RuntimeServiceHandler.
type runtimeServer struct {
	mgr *Manager
}

var _ apiv1connect.RuntimeServiceHandler = (*runtimeServer)(nil)

// requireRunningStageForUser looks up a stage by ID and verifies it belongs to the user and is running.
func (s *runtimeServer) requireRunningStageForUser(stageID, userID string) (*Stage, error) {
	row, err := dbGetStage(s.mgr.db, stageID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if row == nil || row.UserID != userID {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("stage not found"))
	}
	stage, ok := s.mgr.getStage(stageID)
	if !ok || stage.Status != StatusRunning || stage.PodIP == "" {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("stage is not active"))
	}
	return stage, nil
}

func (s *runtimeServer) SetScript(ctx context.Context, req *connect.Request[apiv1.SetScriptRequest]) (*connect.Response[apiv1.SetScriptResponse], error) {
	info := mustAuth(ctx)

	stage, err := s.requireRunningStageForUser(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, err
	}

	if err := s.mgr.pc.SetScript(stage.PodIP, req.Msg.Script); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Persist script to DB for restore on next activation
	if s.mgr.db != nil {
		if err := dbSetStageScript(s.mgr.db, req.Msg.StageId, req.Msg.Script); err != nil {
			log.Printf("WARN: failed to persist script for stage %s: %v", req.Msg.StageId, err)
		}
	}

	return connect.NewResponse(&apiv1.SetScriptResponse{Ok: true}), nil
}

func (s *runtimeServer) GetScript(ctx context.Context, req *connect.Request[apiv1.GetScriptRequest]) (*connect.Response[apiv1.GetScriptResponse], error) {
	info := mustAuth(ctx)

	stage, err := s.requireRunningStageForUser(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, err
	}

	result, err := s.mgr.pc.GetScript(stage.PodIP)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.GetScriptResponse{Script: result.Script}), nil
}

func (s *runtimeServer) EditScript(ctx context.Context, req *connect.Request[apiv1.EditScriptRequest]) (*connect.Response[apiv1.EditScriptResponse], error) {
	info := mustAuth(ctx)

	stage, err := s.requireRunningStageForUser(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, err
	}

	if err := s.mgr.pc.EditScript(stage.PodIP, req.Msg.OldString, req.Msg.NewString); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Async persist updated script to DB
	if s.mgr.db != nil {
		go s.mgr.persistScriptFromPod(req.Msg.StageId, stage)
	}

	return connect.NewResponse(&apiv1.EditScriptResponse{Ok: true}), nil
}

func (s *runtimeServer) EmitEvent(ctx context.Context, req *connect.Request[apiv1.EmitEventRequest]) (*connect.Response[apiv1.EmitEventResponse], error) {
	info := mustAuth(ctx)

	stage, err := s.requireRunningStageForUser(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, err
	}

	// Validate data is valid JSON
	var dataObj map[string]any
	if err := json.Unmarshal([]byte(req.Msg.Data), &dataObj); err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("data must be a valid JSON object: %w", err))
	}

	if err := s.mgr.pc.EmitEvent(stage.PodIP, req.Msg.Event, req.Msg.Data); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.EmitEventResponse{Ok: true}), nil
}

func (s *runtimeServer) GetLogs(ctx context.Context, req *connect.Request[apiv1.GetLogsRequest]) (*connect.Response[apiv1.GetLogsResponse], error) {
	info := mustAuth(ctx)

	stage, err := s.requireRunningStageForUser(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, err
	}

	limit := int(req.Msg.Limit)
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}

	entries, err := s.mgr.pc.GetLogs(stage.PodIP, limit)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	pbEntries := make([]*apiv1.LogEntry, len(entries))
	for i, e := range entries {
		pbEntries[i] = &apiv1.LogEntry{
			Level:     e.Level,
			Message:   e.Message,
			Timestamp: e.Timestamp,
		}
	}

	return connect.NewResponse(&apiv1.GetLogsResponse{Entries: pbEntries}), nil
}

func (s *runtimeServer) Screenshot(ctx context.Context, req *connect.Request[apiv1.ScreenshotRequest]) (*connect.Response[apiv1.ScreenshotResponse], error) {
	info := mustAuth(ctx)

	stage, err := s.requireRunningStageForUser(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, err
	}

	imageBytes, err := s.mgr.pc.Screenshot(stage.PodIP)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.ScreenshotResponse{Image: imageBytes}), nil
}

func (s *runtimeServer) ObsCommand(ctx context.Context, req *connect.Request[apiv1.ObsCommandRequest]) (*connect.Response[apiv1.ObsCommandResponse], error) {
	info := mustAuth(ctx)

	stage, err := s.requireRunningStageForUser(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, err
	}

	args := req.Msg.Args

	if isBlockedObsCommand(args) {
		return nil, connect.NewError(connect.CodePermissionDenied, fmt.Errorf("access denied: stream service settings contain credentials and cannot be read"))
	}

	// When going live, ensure stream destination is configured first
	if isStartStreamCommand(args) {
		dest, err := s.mgr.validateStreamDestination(req.Msg.StageId, info.UserID)
		if err != nil {
			return nil, connect.NewError(connect.CodeFailedPrecondition, err)
		}
		if err := s.mgr.configureOBSStream(stage, dest); err != nil {
			return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("configure stream: %w", err))
		}
	}

	output, err := s.mgr.pc.ObsCommand(stage.PodIP, args)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("%s", redactStreamSecrets(err.Error())))
	}

	return connect.NewResponse(&apiv1.ObsCommandResponse{Output: redactStreamSecrets(output)}), nil
}

func (s *runtimeServer) SyncDiff(ctx context.Context, req *connect.Request[apiv1.SyncDiffRequest]) (*connect.Response[apiv1.SyncDiffResponse], error) {
	info := mustAuth(ctx)

	stage, err := s.requireRunningStageForUser(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, err
	}

	result, err := s.mgr.pc.SyncDiff(stage.PodIP, req.Msg.Files, req.Msg.Entry)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.SyncDiffResponse{Need: result.Need}), nil
}

func (s *runtimeServer) SyncPush(ctx context.Context, stream *connect.ClientStream[apiv1.SyncPushRequest]) (*connect.Response[apiv1.SyncPushResponse], error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Minute)
	defer cancel()

	// First message must include stage_id
	if !stream.Receive() {
		if err := stream.Err(); err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("empty stream"))
	}

	first := stream.Msg()
	if first.StageId == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("first message must include stage_id"))
	}

	info := mustAuth(ctx)
	stage, err := s.requireRunningStageForUser(first.StageId, info.UserID)
	if err != nil {
		return nil, err
	}

	// Stream chunks directly to the pod via io.Pipe — no buffering.
	// A counting writer enforces the 256MB limit without accumulating data.
	const maxSize = 256 * 1024 * 1024 // 256MB
	pr, pw := io.Pipe()

	// Forward pod HTTP response back through this channel
	type pushResult struct {
		result *SyncPushResult
		err    error
	}
	resultCh := make(chan pushResult, 1)

	go func() {
		res, err := s.mgr.pc.SyncPush(stage.PodIP, pr)
		resultCh <- pushResult{res, err}
	}()

	// Write chunks into the pipe
	var written int64
	writeChunk := func(chunk []byte) error {
		if len(chunk) == 0 {
			return nil
		}
		written += int64(len(chunk))
		if written > int64(maxSize) {
			return fmt.Errorf("tar payload exceeds 256MB limit")
		}
		_, err := pw.Write(chunk)
		return err
	}

	if err := writeChunk(first.Chunk); err != nil {
		pw.CloseWithError(err)
		<-resultCh
		return nil, connect.NewError(connect.CodeResourceExhausted, err)
	}

	for stream.Receive() {
		if err := writeChunk(stream.Msg().Chunk); err != nil {
			pw.CloseWithError(err)
			<-resultCh
			return nil, connect.NewError(connect.CodeResourceExhausted, err)
		}
	}
	if err := stream.Err(); err != nil {
		pw.CloseWithError(err)
		<-resultCh
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	pw.Close()

	// Wait for pod response
	res := <-resultCh
	if res.err != nil {
		return nil, connect.NewError(connect.CodeInternal, res.err)
	}

	return connect.NewResponse(&apiv1.SyncPushResponse{Synced: res.result.Synced, Deleted: res.result.Deleted}), nil
}

func (s *runtimeServer) Refresh(ctx context.Context, req *connect.Request[apiv1.RefreshRequest]) (*connect.Response[apiv1.RefreshResponse], error) {
	info := mustAuth(ctx)

	stage, err := s.requireRunningStageForUser(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, err
	}

	if err := s.mgr.pc.SyncRefresh(stage.PodIP); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.RefreshResponse{Ok: true}), nil
}

// base64EncodeBytes is a helper used in MCP screenshot handler after refactor.
func base64EncodeBytes(b []byte) string {
	return base64.StdEncoding.EncodeToString(b)
}
