package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"connectrpc.com/connect"

	sidecarv1 "github.com/browser-streamer/sidecar/gen/api/v1"
	sidecarv1connect "github.com/browser-streamer/sidecar/gen/api/v1/sidecarv1connect"
)

type podClient struct {
	agentHTTPClient *http.Client // mTLS client for all sidecar communication (HTTPS)
}

func newPodClient() *podClient {
	return &podClient{}
}

// httpClientForStage returns the mTLS client, or a plain client if mTLS not configured.
func (p *podClient) httpClientForStage(_ *Stage) *http.Client {
	if p.agentHTTPClient != nil {
		return p.agentHTTPClient
	}
	return &http.Client{Timeout: 30 * time.Second}
}

// syncHTTPClientForStage returns a long-timeout mTLS client for large uploads.
func (p *podClient) syncHTTPClientForStage(_ *Stage) *http.Client {
	if p.agentHTTPClient != nil {
		return &http.Client{
			Timeout:   6 * time.Minute,
			Transport: p.agentHTTPClient.Transport,
		}
	}
	return &http.Client{Timeout: 6 * time.Minute}
}

// sidecarBaseURL returns the ConnectRPC base URL for a pod's sidecar.
func sidecarBaseURL(podIP string) string {
	return fmt.Sprintf("https://%s:8080/_dz_9f7a3b1c", podIP)
}

// sidecarURLForStage returns the sidecar URL for a stage. Uses the stage's SidecarURL
// if set (GPU cluster), otherwise derives from PodIP (local k8s).
func sidecarURLForStage(stage *Stage) string {
	if stage.SidecarURL != "" {
		return stage.SidecarURL
	}
	return sidecarBaseURL(stage.PodIP)
}

// connectOpts returns client options. mTLS is handled at the transport layer.
func (p *podClient) connectOpts() []connect.ClientOption {
	return nil
}

// LogEntry is a single browser console log entry.
type LogEntry struct {
	Level     string `json:"level"`
	Message   string `json:"text"`
	Timestamp string `json:"ts"`
}

func (p *podClient) EmitEvent(stage *Stage, event, data string) error {
	client := sidecarv1connect.NewRuntimeServiceClient(p.httpClientForStage(stage), sidecarURLForStage(stage), p.connectOpts()...)
	_, err := client.EmitEvent(context.Background(), connect.NewRequest(&sidecarv1.EmitEventRequest{
		Event: event,
		Data:  data,
	}))
	if err != nil {
		return fmt.Errorf("emit event: %w", err)
	}
	return nil
}

func (p *podClient) GetLogs(stage *Stage, limit int) ([]LogEntry, error) {
	client := sidecarv1connect.NewRuntimeServiceClient(p.httpClientForStage(stage), sidecarURLForStage(stage), p.connectOpts()...)
	resp, err := client.GetLogs(context.Background(), connect.NewRequest(&sidecarv1.GetLogsRequest{
		Limit: int32(limit),
	}))
	if err != nil {
		return nil, fmt.Errorf("get logs: %w", err)
	}
	entries := make([]LogEntry, len(resp.Msg.Entries))
	for i, e := range resp.Msg.Entries {
		entries[i] = LogEntry{
			Level:     e.Level,
			Message:   e.Text,
			Timestamp: fmt.Sprintf("%f", e.Ts),
		}
	}
	return entries, nil
}

// Screenshot captures a screenshot via the sidecar's RPC and returns raw PNG bytes.
func (p *podClient) Screenshot(stage *Stage) ([]byte, error) {
	client := sidecarv1connect.NewRuntimeServiceClient(p.httpClientForStage(stage), sidecarURLForStage(stage), p.connectOpts()...)
	resp, err := client.Screenshot(context.Background(), connect.NewRequest(&sidecarv1.ScreenshotRequest{}))
	if err != nil {
		return nil, fmt.Errorf("screenshot: %w", err)
	}
	return resp.Msg.Image, nil
}

// --- Stats ---

type StageStats struct {
	StageFPS               float64
	BroadcastFPS           float64
	DroppedFrames          int64
	DroppedFramesRecent    int64
	TotalBytes             int64
	ActiveOutputs          int32
	OutputNames            []string
	BroadcastUptimeSeconds int64
	StageUptimeSeconds     int64
}

func (p *podClient) GetStats(stage *Stage) (*StageStats, error) {
	client := sidecarv1connect.NewRuntimeServiceClient(p.httpClientForStage(stage), sidecarURLForStage(stage), p.connectOpts()...)
	resp, err := client.GetStats(context.Background(), connect.NewRequest(&sidecarv1.GetStatsRequest{}))
	if err != nil {
		return nil, fmt.Errorf("get stats: %w", err)
	}
	return &StageStats{
		StageFPS:               resp.Msg.StageFps,
		BroadcastFPS:           resp.Msg.BroadcastFps,
		DroppedFrames:          resp.Msg.DroppedFrames,
		DroppedFramesRecent:    resp.Msg.DroppedFramesRecent,
		TotalBytes:             resp.Msg.TotalBytes,
		ActiveOutputs:          resp.Msg.ActiveOutputs,
		OutputNames:            resp.Msg.OutputNames,
		BroadcastUptimeSeconds: resp.Msg.BroadcastUptimeSeconds,
		StageUptimeSeconds:     resp.Msg.StageUptimeSeconds,
	}, nil
}

// --- Sync methods ---

type SyncDiffResult struct {
	Need []string `json:"need"`
}

type SyncPushResult struct {
	Synced  int32 `json:"synced"`
	Deleted int32 `json:"deleted"`
}

func (p *podClient) SyncDiff(stage *Stage, files map[string]string, entry string) (*SyncDiffResult, error) {
	client := sidecarv1connect.NewSyncServiceClient(p.httpClientForStage(stage), sidecarURLForStage(stage), p.connectOpts()...)
	resp, err := client.Diff(context.Background(), connect.NewRequest(&sidecarv1.SyncDiffRequest{
		Files: files,
		Entry: entry,
	}))
	if err != nil {
		return nil, fmt.Errorf("sync diff: %w", err)
	}
	return &SyncDiffResult{Need: resp.Msg.Need}, nil
}

func (p *podClient) SyncPush(stage *Stage, body io.Reader) (*SyncPushResult, error) {
	client := sidecarv1connect.NewSyncServiceClient(p.syncHTTPClientForStage(stage), sidecarURLForStage(stage), p.connectOpts()...)
	stream := client.Push(context.Background())

	// Read body in chunks and send as streaming RPC
	buf := make([]byte, 64*1024) // 64KB chunks
	for {
		n, err := body.Read(buf)
		if n > 0 {
			chunk := make([]byte, n)
			copy(chunk, buf[:n])
			if sendErr := stream.Send(&sidecarv1.SyncPushRequest{Chunk: chunk}); sendErr != nil {
				return nil, fmt.Errorf("sync push send: %w", sendErr)
			}
		}
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("sync push read: %w", err)
		}
	}

	resp, err := stream.CloseAndReceive()
	if err != nil {
		return nil, fmt.Errorf("sync push: %w", err)
	}

	return &SyncPushResult{
		Synced:  resp.Msg.Synced,
		Deleted: resp.Msg.Deleted,
	}, nil
}

func (p *podClient) SyncRefresh(stage *Stage) error {
	client := sidecarv1connect.NewSyncServiceClient(p.httpClientForStage(stage), sidecarURLForStage(stage), p.connectOpts()...)
	_, err := client.Refresh(context.Background(), connect.NewRequest(&sidecarv1.SyncRefreshRequest{}))
	if err != nil {
		return fmt.Errorf("sync refresh: %w", err)
	}
	return nil
}

// OutputTarget represents an RTMP output destination for the sidecar pipeline.
type OutputTarget struct {
	Name    string
	RtmpURL string
}

// SetOutputs updates the sidecar pipeline's RTMP output destinations.
// Pass an empty slice to stop all outputs.
func (p *podClient) SetOutputs(stage *Stage, outputs []OutputTarget) error {
	client := sidecarv1connect.NewOutputPipelineServiceClient(p.httpClientForStage(stage), sidecarURLForStage(stage), p.connectOpts()...)
	pbOutputs := make([]*sidecarv1.OutputTarget, len(outputs))
	for i, o := range outputs {
		pbOutputs[i] = &sidecarv1.OutputTarget{Name: o.Name, RtmpUrl: o.RtmpURL}
	}
	_, err := client.SetOutputs(context.Background(), connect.NewRequest(&sidecarv1.SetOutputsRequest{
		Outputs: pbOutputs,
	}))
	if err != nil {
		return fmt.Errorf("set outputs: %w", err)
	}
	return nil
}

// --- Agent RPC methods (GPU node agent) ---

// agentCreateStage calls the agent's CreateStage RPC to provision a stage on a GPU node.
// Returns the assigned internal port for the new stage.
func (m *Manager) agentCreateStage(ctx context.Context, agentURL, stageID, userID string) (int32, error) {
	httpClient := m.agentHTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}

	client := sidecarv1connect.NewAgentServiceClient(httpClient, agentURL)

	// Build R2 config for stage persistence
	req := &sidecarv1.CreateStageRequest{
		StageId: stageID,
		UserId:  userID,
	}

	// Pass R2 config if available
	r2Endpoint := os.Getenv("R2_ENDPOINT")
	r2AccessKey := os.Getenv("R2_ACCESS_KEY_ID")
	r2SecretKey := os.Getenv("R2_SECRET_ACCESS_KEY")
	r2Bucket := os.Getenv("R2_BUCKET")
	if r2Endpoint != "" && r2AccessKey != "" && r2SecretKey != "" {
		req.R2Config = &sidecarv1.R2Config{
			Endpoint:       r2Endpoint,
			AccessKeyId:    r2AccessKey,
			SecretAccessKey: r2SecretKey,
			Bucket:         r2Bucket,
		}
	}

	resp, err := client.CreateStage(ctx, connect.NewRequest(req))
	if err != nil {
		return 0, fmt.Errorf("agent CreateStage: %w", err)
	}
	return resp.Msg.Port, nil
}

// agentDestroyStage calls the agent's DestroyStage RPC to tear down a stage on a GPU node.
func (m *Manager) agentDestroyStage(ctx context.Context, agentURL, stageID string) error {
	httpClient := m.agentHTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 30 * time.Second}
	}

	client := sidecarv1connect.NewAgentServiceClient(httpClient, agentURL)
	_, err := client.DestroyStage(ctx, connect.NewRequest(&sidecarv1.DestroyStageRequest{
		StageId: stageID,
	}))
	if err != nil {
		return fmt.Errorf("agent DestroyStage: %w", err)
	}
	return nil
}

