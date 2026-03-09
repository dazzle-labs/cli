package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"connectrpc.com/connect"

	sidecarv1 "github.com/browser-streamer/sidecar/gen/api/v1"
	sidecarv1connect "github.com/browser-streamer/sidecar/gen/api/v1/sidecarv1connect"
)

type podClient struct {
	httpClient *http.Client
	podToken   string
}

func newPodClient(podToken string) *podClient {
	return &podClient{
		httpClient: &http.Client{Timeout: 30 * time.Second},
		podToken:   podToken,
	}
}

// sidecarBaseURL returns the ConnectRPC base URL for a pod's sidecar.
func sidecarBaseURL(podIP string) string {
	return fmt.Sprintf("http://%s:8080/_dz_9f7a3b1c", podIP)
}

// connectOpts returns client options with auth token.
func (p *podClient) connectOpts() []connect.ClientOption {
	return []connect.ClientOption{
		connect.WithInterceptors(podTokenInterceptor(p.podToken)),
	}
}

// podTokenInterceptor injects the pod token as a Bearer header.
func podTokenInterceptor(token string) connect.UnaryInterceptorFunc {
	return func(next connect.UnaryFunc) connect.UnaryFunc {
		return func(ctx context.Context, req connect.AnyRequest) (connect.AnyResponse, error) {
			if token != "" {
				req.Header().Set("Authorization", "Bearer "+token)
			}
			return next(ctx, req)
		}
	}
}

// LogEntry is a single browser console log entry.
type LogEntry struct {
	Level     string  `json:"level"`
	Message   string  `json:"text"`
	Timestamp string  `json:"ts"`
}

func (p *podClient) EmitEvent(podIP, event, data string) error {
	client := sidecarv1connect.NewRuntimeServiceClient(p.httpClient, sidecarBaseURL(podIP), p.connectOpts()...)
	_, err := client.EmitEvent(context.Background(), connect.NewRequest(&sidecarv1.EmitEventRequest{
		Event: event,
		Data:  data,
	}))
	if err != nil {
		return fmt.Errorf("emit event: %w", err)
	}
	return nil
}

func (p *podClient) GetLogs(podIP string, limit int) ([]LogEntry, error) {
	client := sidecarv1connect.NewRuntimeServiceClient(p.httpClient, sidecarBaseURL(podIP), p.connectOpts()...)
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
func (p *podClient) Screenshot(podIP string) ([]byte, error) {
	client := sidecarv1connect.NewRuntimeServiceClient(p.httpClient, sidecarBaseURL(podIP), p.connectOpts()...)
	resp, err := client.Screenshot(context.Background(), connect.NewRequest(&sidecarv1.ScreenshotRequest{}))
	if err != nil {
		return nil, fmt.Errorf("screenshot: %w", err)
	}
	return resp.Msg.Image, nil
}

// --- Sync methods ---

type SyncDiffResult struct {
	Need []string `json:"need"`
}

type SyncPushResult struct {
	Synced  int32 `json:"synced"`
	Deleted int32 `json:"deleted"`
}

func (p *podClient) SyncDiff(podIP string, files map[string]string, entry string) (*SyncDiffResult, error) {
	client := sidecarv1connect.NewSyncServiceClient(p.httpClient, sidecarBaseURL(podIP), p.connectOpts()...)
	resp, err := client.Diff(context.Background(), connect.NewRequest(&sidecarv1.SyncDiffRequest{
		Files: files,
		Entry: entry,
	}))
	if err != nil {
		return nil, fmt.Errorf("sync diff: %w", err)
	}
	return &SyncDiffResult{Need: resp.Msg.Need}, nil
}

// syncHTTPClient has a longer timeout for large tar uploads.
var syncHTTPClient = &http.Client{Timeout: 6 * time.Minute}

func (p *podClient) SyncPush(podIP string, body io.Reader) (*SyncPushResult, error) {
	client := sidecarv1connect.NewSyncServiceClient(syncHTTPClient, sidecarBaseURL(podIP), p.connectOpts()...)
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

func (p *podClient) SyncRefresh(podIP string) error {
	client := sidecarv1connect.NewSyncServiceClient(p.httpClient, sidecarBaseURL(podIP), p.connectOpts()...)
	_, err := client.Refresh(context.Background(), connect.NewRequest(&sidecarv1.SyncRefreshRequest{}))
	if err != nil {
		return fmt.Errorf("sync refresh: %w", err)
	}
	return nil
}

// ObsCommand executes a gobs-cli command via the sidecar's OBS RPC.
func (p *podClient) ObsCommand(podIP string, args []string) (string, error) {
	client := sidecarv1connect.NewObsServiceClient(p.httpClient, sidecarBaseURL(podIP), p.connectOpts()...)
	resp, err := client.Command(context.Background(), connect.NewRequest(&sidecarv1.ObsCommandRequest{
		Args: args,
	}))
	if err != nil {
		return "", fmt.Errorf("obs command: %w", err)
	}
	return resp.Msg.Output, nil
}

// base64EncodeBytes is a helper used in MCP screenshot handler.
func base64EncodeBytes(b []byte) string {
	return base64.StdEncoding.EncodeToString(b)
}

// redactStreamSecrets removes RTMP URLs, stream-key-like values, and preview tokens from output.
func redactStreamSecrets(output string) string {
	// Redact preview tokens (dpt_ followed by hex chars)
	for {
		idx := strings.Index(output, "dpt_")
		if idx == -1 {
			break
		}
		end := idx + 4
		for end < len(output) && ((output[end] >= '0' && output[end] <= '9') || (output[end] >= 'a' && output[end] <= 'f')) {
			end++
		}
		if end == idx+4 {
			output = output[:idx] + "dpt\u00a7" + output[idx+4:]
			continue
		}
		output = output[:idx] + "[REDACTED]" + output[end:]
	}
	output = strings.ReplaceAll(output, "dpt\u00a7", "dpt_")

	// Redact rtmp:// and rtmps:// URLs
	for {
		idx := strings.Index(strings.ToLower(output), "rtmp")
		if idx == -1 {
			break
		}
		rest := output[idx:]
		if !strings.HasPrefix(strings.ToLower(rest), "rtmp://") && !strings.HasPrefix(strings.ToLower(rest), "rtmps://") {
			output = output[:idx] + "[redacted]" + output[idx+4:]
			continue
		}
		end := idx + len(rest)
		for j, c := range rest {
			if c == ' ' || c == '\n' || c == '\r' || c == '"' || c == '\'' || c == '\t' {
				end = idx + j
				break
			}
		}
		output = output[:idx] + "[redacted]" + output[end:]
	}
	return output
}
