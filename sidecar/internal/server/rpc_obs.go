package server

import (
	"context"
	"fmt"
	"strings"
	"sync"

	"connectrpc.com/connect"

	sidecarv1 "github.com/browser-streamer/sidecar/gen/api/v1"
)

// obsServer implements sidecarv1connect.ObsServiceHandler.
// It translates gobs-cli style commands to pipeline operations,
// maintaining backward compatibility with existing CLI/MCP callers.
type obsServer struct {
	s *Server

	// Stream config stored by "settings stream-service" commands
	mu        sync.Mutex
	rtmpURL   string
	streamKey string
}

func (h *obsServer) Command(ctx context.Context, req *connect.Request[sidecarv1.ObsCommandRequest]) (*connect.Response[sidecarv1.ObsCommandResponse], error) {
	args := req.Msg.Args
	if len(args) == 0 {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("no command specified"))
	}

	output, err := h.handleCommand(args)
	if err != nil {
		return nil, connect.NewError(connect.CodeInternal, err)
	}

	return connect.NewResponse(&sidecarv1.ObsCommandResponse{Output: output}), nil
}

func (h *obsServer) handleCommand(args []string) (string, error) {
	cmd := args[0]

	switch cmd {
	case "st", "stream":
		return h.handleStream(args[1:])

	case "settings", "set":
		return h.handleSettings(args[1:])

	case "sc", "scene":
		return h.handleScene(args[1:])

	case "si", "sceneitem":
		return h.handleSceneItem(args[1:])

	default:
		return "", fmt.Errorf("command %q not supported (OBS replaced with ffmpeg pipeline)", cmd)
	}
}

// handleStream handles st/stream subcommands (start, stop, status).
func (h *obsServer) handleStream(args []string) (string, error) {
	if len(args) == 0 {
		return "", fmt.Errorf("stream subcommand required (s/st/ss)")
	}

	switch args[0] {
	case "s", "start":
		h.mu.Lock()
		rtmpURL := h.rtmpURL
		streamKey := h.streamKey
		h.mu.Unlock()

		if rtmpURL == "" {
			return "", fmt.Errorf("stream service not configured — set RTMP URL first")
		}

		fullURL := rtmpURL
		if streamKey != "" {
			fullURL = strings.TrimSuffix(rtmpURL, "/") + "/" + streamKey
		}

		if err := h.s.pipeline.StartBroadcast(fullURL); err != nil {
			return "", fmt.Errorf("start broadcast: %w", err)
		}
		return "Stream started", nil

	case "st", "stop":
		if err := h.s.pipeline.StopBroadcast(); err != nil {
			return "", fmt.Errorf("stop broadcast: %w", err)
		}
		return "Stream stopped", nil

	case "ss", "status":
		stats := h.s.pipeline.GetStats()
		if stats.Broadcasting {
			return fmt.Sprintf("Streaming: active (fps=%.1f, speed=%.2fx)", stats.FPS, stats.Speed), nil
		}
		return "Streaming: inactive", nil

	default:
		return "", fmt.Errorf("unknown stream subcommand: %s", args[0])
	}
}

// handleSettings handles settings/set subcommands.
// The main one is "settings stream-service" which configures the RTMP destination.
func (h *obsServer) handleSettings(args []string) (string, error) {
	if len(args) < 1 {
		return "", fmt.Errorf("settings subcommand required")
	}

	sub := args[0]
	if sub == "stream-service" || sub == "ss" {
		return h.handleStreamService(args[1:])
	}

	return "", fmt.Errorf("settings %q not supported", sub)
}

// handleStreamService configures the RTMP stream destination.
// Accepts: settings stream-service rtmp_custom --server URL --key KEY
func (h *obsServer) handleStreamService(args []string) (string, error) {
	h.mu.Lock()
	defer h.mu.Unlock()

	// Parse --server and --key flags
	for i := 0; i < len(args); i++ {
		switch args[i] {
		case "--server":
			if i+1 < len(args) {
				h.rtmpURL = args[i+1]
				i++
			}
		case "--key":
			if i+1 < len(args) {
				h.streamKey = args[i+1]
				i++
			}
		}
	}

	return "OK", nil
}

// handleScene handles scene commands — returns static responses since we have a single scene.
func (h *obsServer) handleScene(args []string) (string, error) {
	if len(args) == 0 {
		return "Scene", nil
	}
	switch args[0] {
	case "ls", "list":
		return "Scene", nil
	case "current":
		return "Scene", nil
	default:
		return "OK", nil
	}
}

// handleSceneItem handles scene item commands — returns static responses.
func (h *obsServer) handleSceneItem(args []string) (string, error) {
	if len(args) == 0 {
		return "Screen", nil
	}
	switch args[0] {
	case "ls", "list":
		return "Screen (visible)", nil
	case "sh", "show":
		return "OK", nil
	case "hd", "hide":
		return "OK", nil
	default:
		return "OK", nil
	}
}
