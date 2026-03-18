package agent

import (
	"context"

	"connectrpc.com/connect"

	sidecarv1 "github.com/browser-streamer/sidecar/gen/api/v1"
)

// rpcHandler implements the AgentService ConnectRPC interface.
type rpcHandler struct {
	agent *Agent
}

func newRPCHandler(agent *Agent) *rpcHandler {
	return &rpcHandler{agent: agent}
}

func (h *rpcHandler) CreateStage(ctx context.Context, req *connect.Request[sidecarv1.CreateStageRequest]) (*connect.Response[sidecarv1.CreateStageResponse], error) {
	msg := req.Msg

	var r2Endpoint, r2AccessKey, r2SecretKey, r2Bucket string
	if msg.R2Config != nil {
		r2Endpoint = msg.R2Config.Endpoint
		r2AccessKey = msg.R2Config.AccessKeyId
		r2SecretKey = msg.R2Config.SecretAccessKey
		r2Bucket = msg.R2Config.Bucket
	}

	port, err := h.agent.CreateStage(msg.StageId, msg.UserId, r2Endpoint, r2AccessKey, r2SecretKey, r2Bucket)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&sidecarv1.CreateStageResponse{
		Port: int32(port),
	}), nil
}

func (h *rpcHandler) DestroyStage(ctx context.Context, req *connect.Request[sidecarv1.DestroyStageRequest]) (*connect.Response[sidecarv1.DestroyStageResponse], error) {
	if err := h.agent.DestroyStage(req.Msg.StageId); err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(&sidecarv1.DestroyStageResponse{}), nil
}

func (h *rpcHandler) ListStages(ctx context.Context, req *connect.Request[sidecarv1.ListStagesRequest]) (*connect.Response[sidecarv1.ListStagesResponse], error) {
	stages := h.agent.ListStages()
	var infos []*sidecarv1.StageInfo
	for _, s := range stages {
		infos = append(infos, &sidecarv1.StageInfo{
			StageId: s.StageID,
			Port:    s.Port,
			Status:  s.Status,
		})
	}
	return connect.NewResponse(&sidecarv1.ListStagesResponse{
		Stages: infos,
	}), nil
}

func (h *rpcHandler) Health(ctx context.Context, req *connect.Request[sidecarv1.AgentHealthRequest]) (*connect.Response[sidecarv1.AgentHealthResponse], error) {
	return connect.NewResponse(&sidecarv1.AgentHealthResponse{
		MaxStages:     int32(h.agent.maxStages),
		CurrentStages: int32(h.agent.currentStageCount()),
	}), nil
}
