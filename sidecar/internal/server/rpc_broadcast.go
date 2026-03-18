package server

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	sidecarv1 "github.com/browser-streamer/sidecar/gen/api/v1"
)

// broadcastServer implements sidecarv1connect.BroadcastPipelineServiceHandler.
type broadcastServer struct {
	s *Server
}

func (h *broadcastServer) Start(ctx context.Context, req *connect.Request[sidecarv1.BroadcastStartRequest]) (*connect.Response[sidecarv1.BroadcastStartResponse], error) {
	if req.Msg.RtmpUrl == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("rtmp_url is required"))
	}
	if err := h.s.pipeline.StartBroadcast(req.Msg.RtmpUrl); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("start broadcast: %w", err))
	}
	return connect.NewResponse(&sidecarv1.BroadcastStartResponse{}), nil
}

func (h *broadcastServer) Stop(ctx context.Context, req *connect.Request[sidecarv1.BroadcastStopRequest]) (*connect.Response[sidecarv1.BroadcastStopResponse], error) {
	if err := h.s.pipeline.StopBroadcast(); err != nil {
		return nil, connect.NewError(connect.CodeInternal, fmt.Errorf("stop broadcast: %w", err))
	}
	return connect.NewResponse(&sidecarv1.BroadcastStopResponse{}), nil
}
