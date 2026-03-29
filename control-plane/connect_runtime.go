package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"sync"
	"time"

	"connectrpc.com/connect"
	apiv1 "github.com/dazzle-labs/cli/gen/api/v1"
	apiv1connect "github.com/dazzle-labs/cli/gen/api/v1/apiv1connect"
)

// runtimeServer implements apiv1connect.RuntimeServiceHandler.
type runtimeServer struct {
	mgr *Manager

	// pendingR2Sync stores the full client manifest from SyncDiff for use in SyncPush
	// when syncing directly to R2 (stage not running). Keyed by stageID.
	pendingR2SyncMu sync.Mutex
	pendingR2Sync   map[string]map[string]string // stageID -> {path: sha256}
}

var _ apiv1connect.RuntimeServiceHandler = (*runtimeServer)(nil)

// requireRunningStageForUser looks up a stage by ID or slug and verifies it belongs to the user and is running.
func (s *runtimeServer) requireRunningStageForUser(stageID, userID string) (*Stage, error) {
	if id, err := resolveStageID(s.mgr, stageID); err == nil {
		stageID = id
	}
	row, err := dbGetStage(s.mgr.db, stageID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if row == nil || row.UserID != userID {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("stage not found"))
	}
	stage, ok := s.mgr.getStage(stageID)
	if !ok || stage.Status != StatusRunning || (stage.PodIP == "" && stage.SidecarURL == "") {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("stage is not active"))
	}
	return stage, nil
}

// requireStageForUser looks up a stage by ID or slug and verifies it belongs to the user.
// Admin users (ADMIN_USER_IDS) can access any stage.
// Does NOT require the stage to be running. Returns the DB row.
func (s *runtimeServer) requireStageForUser(stageID, userID string) (*stageRow, error) {
	if stageID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("stage ID is required"))
	}
	if id, err := resolveStageID(s.mgr, stageID); err == nil {
		stageID = id
	}
	row, err := dbGetStage(s.mgr.db, stageID)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}
	if row == nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("stage not found"))
	}
	if row.UserID != userID && !isAdmin(userID) {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("stage not found"))
	}
	return row, nil
}

// isStageRunning checks if a stage is currently running with an active sidecar.
func (s *runtimeServer) isStageRunning(stageID string) (*Stage, bool) {
	stage, ok := s.mgr.getStage(stageID)
	if !ok || stage.Status != StatusRunning || (stage.PodIP == "" && stage.SidecarURL == "") {
		return nil, false
	}
	return stage, true
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

	if err := s.mgr.pc.EmitEvent(stage, req.Msg.Event, req.Msg.Data); err != nil {
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

	entries, err := s.mgr.pc.GetLogs(stage, limit)
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

	imageBytes, err := s.mgr.pc.Screenshot(stage)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.ScreenshotResponse{Image: imageBytes}), nil
}

func (s *runtimeServer) SyncDiff(ctx context.Context, req *connect.Request[apiv1.SyncDiffRequest]) (*connect.Response[apiv1.SyncDiffResponse], error) {
	info := mustAuth(ctx)

	row, err := s.requireStageForUser(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, err
	}

	// If stage is running, proxy to sidecar
	if stage, ok := s.isStageRunning(row.ID); ok {
		result, err := s.mgr.pc.SyncDiff(stage, req.Msg.Files, req.Msg.Entry)
		if err != nil {
			return nil, connect.NewError(connect.CodeInternal, err)
		}
		return connect.NewResponse(&apiv1.SyncDiffResponse{Need: result.Need}), nil
	}

	// Stage not running — diff against R2 directly
	if s.mgr.r2Client == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("stage is not active and R2 storage is not configured"))
	}

	need, err := s.mgr.r2Client.ContentDiff(ctx, info.UserID, row.ID, req.Msg.Files)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Store the full client manifest for use in the subsequent SyncPush
	s.pendingR2SyncMu.Lock()
	if s.pendingR2Sync == nil {
		s.pendingR2Sync = map[string]map[string]string{}
	}
	s.pendingR2Sync[row.ID] = req.Msg.Files
	s.pendingR2SyncMu.Unlock()

	return connect.NewResponse(&apiv1.SyncDiffResponse{Need: need}), nil
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
	row, err := s.requireStageForUser(first.StageId, info.UserID)
	if err != nil {
		return nil, err
	}

	const maxSize = 256 * 1024 * 1024 // 256MB

	// If stage is running, proxy to sidecar (existing streaming path)
	if stage, ok := s.isStageRunning(row.ID); ok {
		return s.syncPushToSidecar(ctx, stage, stream, first, maxSize)
	}

	// Stage not running — push directly to R2
	if s.mgr.r2Client == nil {
		return nil, connect.NewError(connect.CodeFailedPrecondition, fmt.Errorf("stage is not active and R2 storage is not configured"))
	}

	return s.syncPushToR2(ctx, info.UserID, row.ID, stream, first, maxSize)
}

// syncPushToSidecar streams tar chunks to the sidecar via io.Pipe.
func (s *runtimeServer) syncPushToSidecar(ctx context.Context, stage *Stage, stream *connect.ClientStream[apiv1.SyncPushRequest], first *apiv1.SyncPushRequest, maxSize int) (*connect.Response[apiv1.SyncPushResponse], error) {
	pr, pw := io.Pipe()

	type pushResult struct {
		result *SyncPushResult
		err    error
	}
	resultCh := make(chan pushResult, 1)

	go func() {
		res, err := s.mgr.pc.SyncPush(stage, pr)
		resultCh <- pushResult{res, err}
	}()

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

	res := <-resultCh
	if res.err != nil {
		return nil, connect.NewError(connect.CodeInternal, res.err)
	}

	return connect.NewResponse(&apiv1.SyncPushResponse{Synced: res.result.Synced, Deleted: res.result.Deleted}), nil
}

// syncPushToR2 buffers the tar stream and uploads files directly to R2.
func (s *runtimeServer) syncPushToR2(ctx context.Context, userID, stageID string, stream *connect.ClientStream[apiv1.SyncPushRequest], first *apiv1.SyncPushRequest, maxSize int) (*connect.Response[apiv1.SyncPushResponse], error) {
	// Buffer the tar — R2 uploads need seekable data per file, and the total
	// is already capped at 256MB by the CLI.
	var buf bytes.Buffer
	var written int64

	writeChunk := func(chunk []byte) error {
		if len(chunk) == 0 {
			return nil
		}
		written += int64(len(chunk))
		if written > int64(maxSize) {
			return fmt.Errorf("tar payload exceeds 256MB limit")
		}
		_, err := buf.Write(chunk)
		return err
	}

	if err := writeChunk(first.Chunk); err != nil {
		return nil, connect.NewError(connect.CodeResourceExhausted, err)
	}
	for stream.Receive() {
		if err := writeChunk(stream.Msg().Chunk); err != nil {
			return nil, connect.NewError(connect.CodeResourceExhausted, err)
		}
	}
	if err := stream.Err(); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	// Use the full client manifest from the preceding SyncDiff for stale cleanup.
	// This is the authoritative set of files the client has.
	s.pendingR2SyncMu.Lock()
	clientManifest := s.pendingR2Sync[stageID]
	delete(s.pendingR2Sync, stageID)
	s.pendingR2SyncMu.Unlock()

	if clientManifest == nil {
		clientManifest = map[string]string{}
	}

	synced, deleted, err := s.mgr.r2Client.ContentPushFromTar(ctx, userID, stageID, &buf, clientManifest)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.SyncPushResponse{Synced: synced, Deleted: deleted}), nil
}

func (s *runtimeServer) GetStageStats(ctx context.Context, req *connect.Request[apiv1.GetStageStatsRequest]) (*connect.Response[apiv1.GetStageStatsResponse], error) {
	info := mustAuth(ctx)

	stage, err := s.requireRunningStageForUser(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, err
	}

	stats, err := s.mgr.pc.GetStats(stage)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.GetStageStatsResponse{
		StageFps:               stats.StageFPS,
		BroadcastFps:           stats.BroadcastFPS,
		DroppedFrames:          stats.DroppedFrames,
		DroppedFramesRecent:    stats.DroppedFramesRecent,
		TotalBytes:             stats.TotalBytes,
		Broadcasting:           stats.ActiveOutputs > 0, // backwards compat
		BroadcastUptimeSeconds: stats.BroadcastUptimeSeconds,
		StageUptimeSeconds:     stats.StageUptimeSeconds,
		ActiveOutputs:          stats.ActiveOutputs,
		OutputNames:            stats.OutputNames,
	}), nil
}

func (s *runtimeServer) Refresh(ctx context.Context, req *connect.Request[apiv1.RefreshRequest]) (*connect.Response[apiv1.RefreshResponse], error) {
	info := mustAuth(ctx)

	stage, err := s.requireRunningStageForUser(req.Msg.StageId, info.UserID)
	if err != nil {
		return nil, err
	}

	if err := s.mgr.pc.SyncRefresh(stage); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&apiv1.RefreshResponse{Ok: true}), nil
}
