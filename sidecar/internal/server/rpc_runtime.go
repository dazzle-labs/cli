package server

import (
	"context"
	"fmt"
	"time"

	"connectrpc.com/connect"

	sidecarv1 "github.com/browser-streamer/sidecar/gen/api/v1"
)

// runtimeServer implements sidecarv1connect.RuntimeServiceHandler.
type runtimeServer struct {
	s *Server
}

func (h *runtimeServer) EmitEvent(ctx context.Context, req *connect.Request[sidecarv1.EmitEventRequest]) (*connect.Response[sidecarv1.EmitEventResponse], error) {
	if req.Msg.Event == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("event required"))
	}

	if !h.s.cdpClient.DispatchEvent(req.Msg.Event, req.Msg.Data) {
		return nil, connect.NewError(connect.CodeUnavailable, fmt.Errorf("CDP not connected"))
	}

	return connect.NewResponse(&sidecarv1.EmitEventResponse{Ok: true}), nil
}

func (h *runtimeServer) GetLogs(ctx context.Context, req *connect.Request[sidecarv1.GetLogsRequest]) (*connect.Response[sidecarv1.GetLogsResponse], error) {
	limit := int(req.Msg.Limit)
	if limit <= 0 {
		limit = 100
	}
	if limit > 1000 {
		limit = 1000
	}

	entries := h.s.logBuffer.Tail(limit)

	pbEntries := make([]*sidecarv1.LogEntry, len(entries))
	for i, e := range entries {
		pbEntries[i] = &sidecarv1.LogEntry{
			Level:  e.Level,
			Text:   e.Text,
			Ts:     e.Ts,
			Source: e.Source,
			Url:    e.URL,
			Line:   int32(e.Line),
		}
	}

	return connect.NewResponse(&sidecarv1.GetLogsResponse{
		Count:   int32(len(entries)),
		Total:   int32(h.s.logBuffer.Total()),
		Entries: pbEntries,
	}), nil
}

func (h *runtimeServer) GetStats(ctx context.Context, req *connect.Request[sidecarv1.GetStatsRequest]) (*connect.Response[sidecarv1.GetStatsResponse], error) {
	h.s.statsMu.Lock()
	ps := h.s.pipelineStats
	bFPS := h.s.browserFPS
	pStart := h.s.pipelineStart
	h.s.statsMu.Unlock()

	now := time.Now()
	var broadcastUptime int64
	if !pStart.IsZero() {
		broadcastUptime = int64(now.Sub(pStart).Seconds())
	}

	return connect.NewResponse(&sidecarv1.GetStatsResponse{
		StageFps:               bFPS,
		BroadcastFps:           ps.FPS,
		DroppedFrames:          ps.DroppedFrames,
		DroppedFramesRecent:    0, // TODO: implement windowed counter
		TotalBytes:             ps.TotalBytes,
		Broadcasting:           ps.Broadcasting,
		BroadcastUptimeSeconds: broadcastUptime,
		StageUptimeSeconds:     int64(now.Sub(h.s.stageStart).Seconds()),
	}), nil
}

func (h *runtimeServer) Navigate(ctx context.Context, req *connect.Request[sidecarv1.NavigateRequest]) (*connect.Response[sidecarv1.NavigateResponse], error) {
	if req.Msg.Url == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("url required"))
	}

	if err := h.s.cdpClient.Navigate(req.Msg.Url); err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&sidecarv1.NavigateResponse{Ok: true}), nil
}

func (h *runtimeServer) Screenshot(ctx context.Context, req *connect.Request[sidecarv1.ScreenshotRequest]) (*connect.Response[sidecarv1.ScreenshotResponse], error) {
	data, err := h.s.cdpClient.Screenshot()
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&sidecarv1.ScreenshotResponse{Image: data}), nil
}
