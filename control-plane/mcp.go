package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os/exec"
	"strings"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// Context key for agent ID extracted from URL path.
type ctxKey string

const agentIDKey ctxKey = "agentID"
const userIDKey ctxKey = "userID"

func agentIDFromCtx(ctx context.Context) string {
	v, _ := ctx.Value(agentIDKey).(string)
	return v
}

func userIDFromCtx(ctx context.Context) string {
	v, _ := ctx.Value(userIDKey).(string)
	return v
}

// setupMCP creates an MCP server with all browser-streamer tools and returns an http.Handler.
func (m *Manager) setupMCP() http.Handler {
	s := server.NewMCPServer("browser-streamer", "1.0.0",
		server.WithToolCapabilities(true),
	)

	s.AddTool(
		mcp.NewTool("start",
			mcp.WithDescription("Activate your stage. Call this before using any other tools. Returns status when ready. Your stage gives you a cloud environment you can render content in, capture screenshots, and stream to platforms like Twitch and YouTube. A stream destination is not required to start — you can preview your stage on stream.dazzle.fm by viewing your stage in the sidebar. Starting the stage does NOT begin streaming — use the obs tool with [\"st\", \"s\"] to go live when you're ready (requires a configured destination)."),
		),
		m.handleMCPCreateStage,
	)

	s.AddTool(
		mcp.NewTool("stop",
			mcp.WithDescription("Deactivate your stage. Shuts down and releases cloud resources. Call start to bring it back — stream destinations are preserved, but the panel script will need to be re-set."),
		),
		m.handleMCPDestroyStage,
	)

	s.AddTool(
		mcp.NewTool("status",
			mcp.WithDescription("Get the current status of your stage (active/inactive/starting)."),
		),
		m.handleMCPStageStatus,
	)

	s.AddTool(
		mcp.NewTool("set_script",
			mcp.WithDescription(`Set JavaScript content to render in your stage. Write vanilla JS or JSX. The page is full-viewport with a black background. Changes are hot-swapped with zero page reloads. Requires an active stage (call start first).

Two modes:
1. Vanilla JS — create DOM elements / canvas and append to document.body
2. React JSX — define an App component and it will be auto-mounted into #root:
     const App = () => <div>Hello</div>;
   Do NOT call createRoot or ReactDOM.render — the runtime auto-mounts your App. On subsequent set_script/edit_script calls, the root is reused for clean HMR transitions.

Available globals (no imports needed):
  React, useState, useEffect, useRef, useMemo, useCallback, useReducer, Fragment,
  useContext, useLayoutEffect, useImperativeHandle, useDebugValue,
  useDeferredValue, useTransition, useId, useSyncExternalStore,
  createContext, forwardRef, memo, lazy, Suspense
  createPortal (from react-dom)
  create, persist (from zustand — use for persistent state via localStorage)

Tailwind CSS v4 utility classes work in className (e.g. "text-4xl font-bold text-white").

Your code can listen for events pushed by emit_event — set up the view once, then drive it with state updates:

  window.addEventListener('event', (e) => {
    const { event, data } = e.detail;
    if (event === 'update') el.textContent = data.msg;
  });

Read window.__state at any time for accumulated state from all prior emit_event calls. An '__init' event fires on module load if state already exists.`),
			mcp.WithString("script", mcp.Required(), mcp.Description("JavaScript or JSX code to render")),
		),
		m.handleMCPSetScript,
	)

	s.AddTool(
		mcp.NewTool("get_script",
			mcp.WithDescription("Get the current JavaScript content being rendered in your stage. Requires an active stage (call start first)."),
		),
		m.handleMCPGetScript,
	)

	s.AddTool(
		mcp.NewTool("edit_script",
			mcp.WithDescription("Edit the current JavaScript content by finding and replacing a string. The old_string must exist exactly once in the current code. Changes are hot-swapped with no page reload. Requires an active stage (call start first)."),
			mcp.WithString("old_string", mcp.Required(), mcp.Description("The exact string to find in the current code")),
			mcp.WithString("new_string", mcp.Required(), mcp.Description("The replacement string")),
		),
		m.handleMCPEditScript,
	)

	s.AddTool(
		mcp.NewTool("emit_event",
			mcp.WithDescription(`Push live data to your running panel without rewriting or reloading the script.

Use with set_script: write your event listeners once, then drive updates with emit_event — no code change, no reload required.

Example:
  set_script: el = div; addEventListener('event', e => { if (e.detail.event === 'score') el.textContent = e.detail.data.points })
  emit_event: { event: "score", data: { points: 42 } }    → el shows "42"
  emit_event: { event: "score", data: { points: 99 } }    → el shows "99"

Accumulated state is merged into window.__state. An '__init' event fires on script load if prior state exists.`),
			mcp.WithString("event", mcp.Required(), mcp.Description("Event name that your set_script code listens for (e.g. 'update', 'alert', 'theme-change')")),
			mcp.WithString("data", mcp.Required(), mcp.Description("JSON object with event payload — merged into window.__state and delivered as e.detail.data")),
		),
		m.handleMCPEmitEvent,
	)

	s.AddTool(
		mcp.NewTool("get_logs",
			mcp.WithDescription("Retrieve recent console logs (errors, warnings, info, debug). Returns the last N entries like tail. Requires an active stage (call start first)."),
			mcp.WithNumber("limit", mcp.Description("Number of most recent log entries to return (default 100, max 1000)")),
		),
		m.handleMCPGetLogs,
	)

	s.AddTool(
		mcp.NewTool("screenshot",
			mcp.WithDescription("Capture a screenshot of your stage's current output as a PNG image. Requires an active stage (call start first)."),
		),
		m.handleMCPScreenshot,
	)

	s.AddTool(
		mcp.NewTool("obs",
			mcp.WithDescription(`Control OBS — manage scenes, inputs, streaming, recording, and audio. Requires an active stage (call start first). Note: starting a stage does NOT go live automatically. Use "st s" to start streaming when ready, and "st st" to stop.

sc ls — list scenes | sc c — current scene | sc sw <name> — switch scene
si ls — list scene items | si sh/h/tg <name> — show/hide/toggle item | si t <name> — transform
g ls — list groups | g sh/h/tg <name> — show/hide/toggle group
i ls — list inputs | i k — list input kinds | i c <kind> <name> — create input
i d <name> — remove | i s <name> — show details | i up <name> — update settings
i m/um/tg <name> — mute/unmute/toggle | i v <name> — set volume
t c <name> — get text | t u <name> --text=STR — update text
st s — start stream | st st — stop stream | st tg — toggle | st ss — stream status
rec s/st/tg — start/stop/toggle recording | rec ss — recording status
rec p/r — pause/resume | rec d — get/set directory | rec sp — split | rec c — chapter
f ls <input> — list filters | f on/off/tg <input> <filter> — enable/disable/toggle
hk ls — list hotkeys | hk tr <name> — trigger hotkey
vc s/st/tg/ss — virtual camera start/stop/toggle/status
sm on/off/tg/ss — studio mode enable/disable/toggle/status
mi c/p/pa/s/r <name> — media cursor/play/pause/stop/restart
ss sv --source=NAME --path=FILE — save screenshot to file
rb s/st/tg/ss/sv — replay buffer start/stop/toggle/status/save
scn ls/c/sw/new — scene collections list/current/switch/create
p ls/c/sw/new/rm — profiles list/current/switch/create/remove
set s — show settings | set v — video settings | set p — profile settings
Stream service settings are managed automatically and cannot be read.

Use ["<cmd>", "--help"] for flags on any command.`),
			mcp.WithArray("args", mcp.Required(), mcp.Description("OBS command arguments, e.g. [\"st\", \"s\"] to start streaming.")),
		),
		m.handleMCPObs,
	)

	s.AddTool(
		mcp.NewTool("set_stream_info",
			mcp.WithDescription("Update the title and/or category of your live stream on the connected platform (Twitch, YouTube, or Kick). Requires a connected platform account — connect one at the dashboard Destinations page if you haven't already."),
			mcp.WithString("title", mcp.Description("New stream title")),
			mcp.WithString("category", mcp.Description("Stream category or game name (e.g. 'Just Chatting', 'Software and Game Development')")),
		),
		m.handleMCPSetStreamInfo,
	)

	s.AddTool(
		mcp.NewTool("get_chat",
			mcp.WithDescription("Read recent chat messages from your live stream. Returns messages from the platform your stage is streaming to. Requires a connected platform account."),
			mcp.WithNumber("limit", mcp.Description("Number of recent messages to return (default 20, max 100)")),
		),
		m.handleMCPGetChat,
	)

	s.AddTool(
		mcp.NewTool("send_chat",
			mcp.WithDescription("Send a message to your live stream's chat as the connected account. Requires a connected platform account."),
			mcp.WithString("message", mcp.Required(), mcp.Description("Chat message to send")),
		),
		m.handleMCPSendChat,
	)

	return server.NewStreamableHTTPServer(s)
}

// mcpMiddleware validates auth, extracts the agent UUID from the URL path,
// strips the prefix so the MCP handler sees /mcp/..., and stores
// the UUID in request context.
// Path format: /stage/<uuid>/mcp or /stage/<uuid>/mcp/...
func (m *Manager) mcpMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		trimmed := strings.TrimPrefix(r.URL.Path, "/stage/")
		if trimmed == r.URL.Path {
			http.NotFound(w, r)
			return
		}

		// trimmed = "<uuid>/mcp/..." or "<uuid>/mcp" or "<uuid>"
		parts := strings.SplitN(trimmed, "/", 2)
		agentID := parts[0]
		if agentID == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"stage UUID required in path: /stage/<uuid>/mcp"}`))
			return
		}

		// Require /mcp suffix
		rest := ""
		if len(parts) > 1 {
			rest = parts[1]
		}
		if !strings.HasPrefix(rest, "mcp") {
			http.NotFound(w, r)
			return
		}

		// Auth check — API key (dzl_) or Clerk JWT
		token := extractBearerToken(r)
		info, err := m.auth.authenticate(r.Context(), token)
		if err != nil || info == nil {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte(`{"error":"unauthorized"}`))
			return
		}

		// Ensure user exists in DB for stage tracking
		if m.db != nil && info.Method == authMethodClerk {
			dbUpsertUser(m.db, info.UserID, "", "")
		}

		// Validate stage UUID exists and belongs to the authenticated user
		if m.db != nil {
			stage, err := dbGetStage(m.db, agentID)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte(`{"error":"internal error"}`))
				return
			}
			if stage == nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusNotFound)
				w.Write([]byte(`{"error":"stage not found"}`))
				return
			} else if stage.UserID != info.UserID {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusNotFound)
				w.Write([]byte(`{"error":"stage not found"}`))
				return
			}
		}

		// Rewrite path: strip /stage/<uuid>/ so MCP handler sees /mcp or /mcp/...
		mcpRest := strings.TrimPrefix(rest, "mcp")
		if mcpRest == "" || mcpRest == "/" {
			r.URL.Path = "/mcp"
		} else {
			r.URL.Path = "/mcp" + mcpRest
		}

		// Store agent ID and user ID in context
		ctx := context.WithValue(r.Context(), agentIDKey, agentID)
		ctx = context.WithValue(ctx, userIDKey, info.UserID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// fetchScriptFromPod retrieves the current user script from a running pod.
func (m *Manager) fetchScriptFromPod(stage *Stage) (string, error) {
	result, err := m.pc.GetScript(stage.PodIP)
	if err != nil {
		return "", err
	}
	return result.Script, nil
}

// persistScriptFromPod fetches the current script from the pod and saves it to DB.
func (m *Manager) persistScriptFromPod(stageID string, stage *Stage) {
	script, err := m.fetchScriptFromPod(stage)
	if err != nil {
		log.Printf("WARN: failed to fetch script from pod for stage %s: %v", stageID, err)
		return
	}
	if err := dbSetStageScript(m.db, stageID, script); err != nil {
		log.Printf("WARN: failed to persist script for stage %s: %v", stageID, err)
	}
}

// restoreScriptToPod pushes a saved script to a newly started pod.
func (m *Manager) restoreScriptToPod(stage *Stage, script string) error {
	return m.pc.SetScript(stage.PodIP, script)
}

// requireRunningStage resolves the agent's stage and verifies it is running.
func (m *Manager) requireRunningStage(ctx context.Context, agentID string) (*Stage, error) {
	stage, ok := m.getStage(agentID)
	if !ok {
		return nil, fmt.Errorf("no stage for agent %s — call start first", agentID)
	}
	if stage.PodIP == "" || stage.Status != StatusRunning {
		return nil, fmt.Errorf("stage %s not ready (status: %s)", agentID, stage.Status)
	}

	return stage, nil
}

func (m *Manager) handleMCPCreateStage(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)
	if agentID == "" {
		return mcp.NewToolResultError("agent ID not found in request context"), nil
	}

	userID := userIDFromCtx(ctx)

	waitCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	readyStage, err := m.activateStage(waitCtx, agentID, userID)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to activate stage: %v", err)), nil
	}

	// Restore persisted script if one exists
	if m.db != nil {
		if script, err := dbGetStageScript(m.db, agentID); err == nil && script != "" {
			if err := m.restoreScriptToPod(readyStage, script); err != nil {
				log.Printf("WARN: failed to restore script for stage %s: %v", agentID, err)
			} else {
				log.Printf("Restored script for stage %s (%d bytes)", agentID, len(script))
			}
		}
	}

	// Configure OBS stream destination if one is set (not required to start)
	dest, destErr := m.validateStreamDestination(agentID, userID)
	if destErr == nil {
		if err := m.configureOBSStream(readyStage, dest); err != nil {
			log.Printf("Warning: failed to configure stream destination for stage %s: %v", agentID, err)
		}
	}

	result, _ := json.Marshal(map[string]any{
		"status": string(readyStage.Status),
	})
	return mcp.NewToolResultText(string(result)), nil
}

// validateStreamDestination looks up the stage's assigned destination and validates it has
// a valid RTMP URL and decryptable stream key. Returns the validated row.
func (m *Manager) validateStreamDestination(stageID, userID string) (*streamDestRow, error) {
	if m.db == nil || userID == "" {
		return nil, fmt.Errorf("no stream destination configured — add one via the API before starting a stage")
	}

	row, err := dbGetStage(m.db, stageID)
	if err != nil {
		return nil, fmt.Errorf("failed to look up stage: %w", err)
	}
	if row == nil {
		return nil, fmt.Errorf("stage not found")
	}
	if !row.DestinationID.Valid || row.DestinationID.String == "" {
		return nil, fmt.Errorf("no stream destination configured for stage %s — select one in the dashboard", stageID)
	}

	dest, err := dbGetStreamDestForUser(m.db, row.DestinationID.String, userID)
	if err != nil {
		return nil, fmt.Errorf("failed to look up stream destination: %w", err)
	}
	if dest == nil {
		return nil, fmt.Errorf("stream destination not found for stage %s — select one in the dashboard", stageID)
	}

	if dest.RtmpURL == "" {
		return nil, fmt.Errorf("stream destination '%s' has no RTMP URL configured", dest.PlatformUsername)
	}
	decryptedKey, err := decryptString(m.encryptionKey, dest.StreamKey)
	if err != nil {
		return nil, fmt.Errorf("stream destination '%s' has an invalid stream key: %w", dest.PlatformUsername, err)
	}
	// Store decrypted key so configureOBSStream doesn't need to decrypt again
	dest.StreamKey = decryptedKey

	return dest, nil
}

// configureOBSStream sets OBS stream settings using the already-validated destination.
// dest.StreamKey must already be decrypted (done by validateStreamDestination).
// Retries with backoff since OBS WebSocket (port 4455) may not be ready immediately
// after the pod readiness probe passes (which only checks Node.js on port 8080).
func (m *Manager) configureOBSStream(stage *Stage, dest *streamDestRow) error {
	log.Printf("Configuring OBS stream for stage %s (dest=%s, platform=%s)", stage.ID, dest.PlatformUsername, dest.Platform)

	args := []string{
		"--host", stage.PodIP, "--port", "4455",
		"settings", "stream-service", "rtmp_custom",
		"--server", dest.RtmpURL,
		"--key", dest.StreamKey,
	}

	const maxRetries = 10
	backoff := time.Second

	var lastErr error
	for attempt := 1; attempt <= maxRetries; attempt++ {
		cmd := exec.CommandContext(context.Background(), "gobs-cli", args...)
		var stderr bytes.Buffer
		cmd.Stderr = &stderr
		if err := cmd.Run(); err != nil {
			lastErr = fmt.Errorf("failed to configure OBS stream settings: %w (%s)", err, stderr.String())
			if attempt < maxRetries {
				log.Printf("OBS not ready on attempt %d/%d, retrying in %v...", attempt, maxRetries, backoff)
				time.Sleep(backoff)
				backoff = time.Duration(float64(backoff) * 1.5)
				if backoff > 10*time.Second {
					backoff = 10 * time.Second
				}
			}
			continue
		}
		if attempt > 1 {
			log.Printf("OBS stream configured successfully on attempt %d", attempt)
		}
		return nil
	}

	return lastErr
}

func (m *Manager) handleMCPDestroyStage(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)
	if agentID == "" {
		return mcp.NewToolResultError("agent ID not found in request context"), nil
	}

	if _, ok := m.getStage(agentID); !ok {
		return mcp.NewToolResultText(`{"status":"inactive"}`), nil
	}

	if err := m.deactivateStage(agentID); err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to stop stage: %v", err)), nil
	}

	return mcp.NewToolResultText(`{"status":"inactive"}`), nil
}

func (m *Manager) handleMCPStageStatus(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)
	if agentID == "" {
		return mcp.NewToolResultError("agent ID not found in request context"), nil
	}

	stage, ok := m.getStage(agentID)
	if !ok {
		result, _ := json.Marshal(map[string]any{
			"status": "inactive",
		})
		return mcp.NewToolResultText(string(result)), nil
	}

	result, _ := json.Marshal(map[string]any{
		"status": string(stage.Status),
	})
	return mcp.NewToolResultText(string(result)), nil
}

func (m *Manager) handleMCPSetScript(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)
	script, err := req.RequireString("script")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := m.pc.SetScript(stage.PodIP, script); err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to set template: %v", err)), nil
	}

	// Persist script to DB for restore on next activation
	if m.db != nil {
		if err := dbSetStageScript(m.db, agentID, script); err != nil {
			log.Printf("WARN: failed to persist script for stage %s: %v", agentID, err)
		}
	}

	return mcp.NewToolResultText(`{"ok":true}`), nil
}

func (m *Manager) handleMCPGetScript(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	result, err := m.pc.GetScript(stage.PodIP)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to get template: %v", err)), nil
	}

	respBody, _ := json.Marshal(result)
	return mcp.NewToolResultText(string(respBody)), nil
}

func (m *Manager) handleMCPEditScript(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)
	oldString, err := req.RequireString("old_string")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	newString, err := req.RequireString("new_string")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := m.pc.EditScript(stage.PodIP, oldString, newString); err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to edit template: %v", err)), nil
	}

	// Persist updated script to DB
	if m.db != nil {
		go m.persistScriptFromPod(agentID, stage)
	}

	return mcp.NewToolResultText(`{"ok":true}`), nil
}

func (m *Manager) handleMCPEmitEvent(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)
	eventName, err := req.RequireString("event")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	dataStr, err := req.RequireString("data")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	// Validate data is valid JSON
	var dataObj map[string]any
	if err := json.Unmarshal([]byte(dataStr), &dataObj); err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("data must be a valid JSON object: %v", err)), nil
	}

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := m.pc.EmitEvent(stage.PodIP, eventName, dataStr); err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to emit event: %v", err)), nil
	}

	return mcp.NewToolResultText(`{"ok":true}`), nil
}

func (m *Manager) handleMCPGetLogs(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	limit := 100
	if v, ok := req.GetArguments()["limit"]; ok {
		if n, ok := v.(float64); ok && n > 0 {
			limit = int(n)
		}
	}
	if limit > 1000 {
		limit = 1000
	}

	entries, err := m.pc.GetLogs(stage.PodIP, limit)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to get logs: %v", err)), nil
	}

	respBody, _ := json.Marshal(entries)
	return mcp.NewToolResultText(string(respBody)), nil
}

func (m *Manager) handleMCPScreenshot(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	imageBytes, err := m.pc.Screenshot(stage.PodIP)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("screenshot failed: %v", err)), nil
	}

	base64PNG := base64EncodeBytes(imageBytes)
	return &mcp.CallToolResult{
		Content: []mcp.Content{
			mcp.NewImageContent(base64PNG, "image/png"),
		},
	}, nil
}

// obsScreenshot captures a screenshot from OBS via its WebSocket v5 protocol.
// Connects to ws://<podIP>:4455, performs the handshake, gets the current scene,
// then requests a screenshot of that scene.
func obsScreenshot(podIP string) (string, error) {
	wsURL := fmt.Sprintf("ws://%s:4455", podIP)
	conn, _, err := websocket.DefaultDialer.Dial(wsURL, nil)
	if err != nil {
		return "", fmt.Errorf("connect to OBS WebSocket: %w", err)
	}
	defer conn.Close()

	// OBS WS v5 handshake: receive Hello (op 0)
	var hello struct {
		Op int `json:"op"`
	}
	if err := conn.ReadJSON(&hello); err != nil {
		return "", fmt.Errorf("read Hello: %w", err)
	}
	if hello.Op != 0 {
		return "", fmt.Errorf("expected Hello (op 0), got op %d", hello.Op)
	}

	// Send Identify (op 1)
	identify := map[string]any{
		"op": 1,
		"d":  map[string]any{"rpcVersion": 1},
	}
	if err := conn.WriteJSON(identify); err != nil {
		return "", fmt.Errorf("send Identify: %w", err)
	}

	// Receive Identified (op 2)
	var identified struct {
		Op int `json:"op"`
	}
	if err := conn.ReadJSON(&identified); err != nil {
		return "", fmt.Errorf("read Identified: %w", err)
	}
	if identified.Op != 2 {
		return "", fmt.Errorf("expected Identified (op 2), got op %d", identified.Op)
	}

	// Request ID counter
	var reqID atomic.Int64

	// Get current program scene
	sceneReqID := fmt.Sprintf("%d", reqID.Add(1))
	getScene := map[string]any{
		"op": 6,
		"d": map[string]any{
			"requestType": "GetCurrentProgramScene",
			"requestId":   sceneReqID,
		},
	}
	if err := conn.WriteJSON(getScene); err != nil {
		return "", fmt.Errorf("send GetCurrentProgramScene: %w", err)
	}

	var sceneResp struct {
		Op int `json:"op"`
		D  struct {
			RequestID    string `json:"requestId"`
			ResponseData struct {
				SceneName string `json:"sceneName"`
			} `json:"responseData"`
			RequestStatus struct {
				Result bool   `json:"result"`
				Code   int    `json:"code"`
				Msg    string `json:"comment"`
			} `json:"requestStatus"`
		} `json:"d"`
	}
	if err := conn.ReadJSON(&sceneResp); err != nil {
		return "", fmt.Errorf("read GetCurrentProgramScene response: %w", err)
	}
	if sceneResp.Op != 7 {
		return "", fmt.Errorf("expected RequestResponse (op 7), got op %d", sceneResp.Op)
	}
	if !sceneResp.D.RequestStatus.Result {
		return "", fmt.Errorf("GetCurrentProgramScene failed: %s", sceneResp.D.RequestStatus.Msg)
	}
	sceneName := sceneResp.D.ResponseData.SceneName

	// Get screenshot of the scene
	ssReqID := fmt.Sprintf("%d", reqID.Add(1))
	getScreenshot := map[string]any{
		"op": 6,
		"d": map[string]any{
			"requestType": "GetSourceScreenshot",
			"requestId":   ssReqID,
			"requestData": map[string]any{
				"sourceName":  sceneName,
				"imageFormat": "png",
			},
		},
	}
	if err := conn.WriteJSON(getScreenshot); err != nil {
		return "", fmt.Errorf("send GetSourceScreenshot: %w", err)
	}

	var ssResp struct {
		Op int `json:"op"`
		D  struct {
			RequestID    string `json:"requestId"`
			ResponseData struct {
				ImageData string `json:"imageData"`
			} `json:"responseData"`
			RequestStatus struct {
				Result bool   `json:"result"`
				Code   int    `json:"code"`
				Msg    string `json:"comment"`
			} `json:"requestStatus"`
		} `json:"d"`
	}
	if err := conn.ReadJSON(&ssResp); err != nil {
		return "", fmt.Errorf("read GetSourceScreenshot response: %w", err)
	}
	if ssResp.Op != 7 {
		return "", fmt.Errorf("expected RequestResponse (op 7), got op %d", ssResp.Op)
	}
	if !ssResp.D.RequestStatus.Result {
		return "", fmt.Errorf("GetSourceScreenshot failed: %s", ssResp.D.RequestStatus.Msg)
	}

	// Strip data:image/png;base64, prefix if present
	imageData := ssResp.D.ResponseData.ImageData
	if idx := strings.Index(imageData, ","); idx != -1 {
		imageData = imageData[idx+1:]
	}

	return imageData, nil
}

// obsBlockedCommands are subcommand sequences that could expose stream credentials.
// The agent should never be able to read the RTMP URL or stream key.
// Includes both full names and shorthands.
var obsBlockedCommands = [][]string{
	{"settings", "stream-service"},
	{"settings", "ss"},
	{"set", "stream-service"},
	{"set", "ss"},
}

// redactStreamSecrets removes RTMP URLs and stream-key-like values from OBS command output.
func redactStreamSecrets(output string) string {
	// Redact rtmp:// and rtmps:// URLs
	for {
		idx := strings.Index(strings.ToLower(output), "rtmp")
		if idx == -1 {
			break
		}
		// Check it's actually rtmp:// or rtmps://
		rest := output[idx:]
		if !strings.HasPrefix(strings.ToLower(rest), "rtmp://") && !strings.HasPrefix(strings.ToLower(rest), "rtmps://") {
			// Not an RTMP URL, skip past this occurrence
			output = output[:idx] + "[redacted]" + output[idx+4:]
			continue
		}
		// Find end of URL (space, newline, quote, or end of string)
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

// isBlockedObsCommand checks if the args match any blocked command prefix.
func isBlockedObsCommand(args []string) bool {
	// Normalize: skip flags (--flag and --flag=val) to find subcommands
	var subcommands []string
	for i := 0; i < len(args); i++ {
		if strings.HasPrefix(args[i], "-") {
			// Skip flag value if it's a separate arg (e.g. --host 1.2.3.4)
			if !strings.Contains(args[i], "=") && i+1 < len(args) {
				i++
			}
			continue
		}
		subcommands = append(subcommands, strings.ToLower(args[i]))
	}

	for _, blocked := range obsBlockedCommands {
		if len(subcommands) >= len(blocked) {
			match := true
			for j, b := range blocked {
				if subcommands[j] != b {
					match = false
					break
				}
			}
			if match {
				return true
			}
		}
	}
	return false
}

// isStartStreamCommand returns true if the args represent "st s" (start streaming).
func isStartStreamCommand(args []string) bool {
	var sub []string
	for i := 0; i < len(args); i++ {
		if strings.HasPrefix(args[i], "-") {
			if !strings.Contains(args[i], "=") && i+1 < len(args) {
				i++
			}
			continue
		}
		sub = append(sub, strings.ToLower(args[i]))
	}
	return len(sub) >= 2 && sub[0] == "st" && sub[1] == "s"
}

func (m *Manager) handleMCPObs(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)

	// Extract args as string array
	argsMap := req.GetArguments()
	argsRaw, ok := argsMap["args"]
	if !ok {
		return mcp.NewToolResultError("args is required"), nil
	}
	argsSlice, ok := argsRaw.([]interface{})
	if !ok {
		return mcp.NewToolResultError("args must be a string array"), nil
	}
	args := make([]string, len(argsSlice))
	for i, a := range argsSlice {
		s, ok := a.(string)
		if !ok {
			return mcp.NewToolResultError(fmt.Sprintf("args[%d] must be a string", i)), nil
		}
		args[i] = s
	}

	// Block commands that could expose stream credentials
	if isBlockedObsCommand(args) {
		return mcp.NewToolResultError("access denied: stream service settings contain credentials and cannot be read. Stream configuration is managed automatically."), nil
	}

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	// When going live, ensure stream destination is configured first
	if isStartStreamCommand(args) {
		userID := userIDFromCtx(ctx)
		dest, err := m.validateStreamDestination(agentID, userID)
		if err != nil {
			return mcp.NewToolResultError(err.Error()), nil
		}
		if err := m.configureOBSStream(stage, dest); err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("failed to configure stream: %v", err)), nil
		}
	}

	log.Printf("MCP obs: stage=%s cmd=gobs-cli %v", stage.ID, args)

	output, err := m.pc.ObsCommand(stage.PodIP, args)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("gobs-cli error: %s", redactStreamSecrets(err.Error()))), nil
	}

	// Redact any stream credentials that might appear in output
	return mcp.NewToolResultText(redactStreamSecrets(output)), nil
}

// resolvePlatformConnection finds the platform connection for the stage's active destination.
// OAuth fields (access token, platform user ID) are now on the streamDestRow itself.
func (m *Manager) resolvePlatformConnection(stageID, userID string) (PlatformClient, *streamDestRow, string, error) {
	if m.db == nil {
		return nil, nil, "", fmt.Errorf("database not available")
	}

	row, err := dbGetStage(m.db, stageID)
	if err != nil {
		return nil, nil, "", fmt.Errorf("failed to look up stage: %w", err)
	}
	if row == nil {
		return nil, nil, "", fmt.Errorf("stage not found")
	}
	if !row.DestinationID.Valid || row.DestinationID.String == "" {
		return nil, nil, "", fmt.Errorf("no stream destination configured for this stage — select one in the dashboard")
	}

	dest, err := dbGetStreamDestForUser(m.db, row.DestinationID.String, userID)
	if err != nil {
		return nil, nil, "", fmt.Errorf("failed to look up destination: %w", err)
	}
	if dest == nil {
		return nil, nil, "", fmt.Errorf("stream destination not found")
	}

	if dest.AccessToken == "" {
		return nil, nil, "", fmt.Errorf("no %s account connected — connect one at the dashboard Destinations page", dest.Platform)
	}

	client, err := GetPlatformClient(dest.Platform)
	if err != nil {
		return nil, nil, "", err
	}

	accessToken, err := refreshPlatformToken(m.db, m.encryptionKey, dest, m.oauth.configs)
	if err != nil {
		log.Printf("WARN: token refresh failed for %s/%s: %v", userID, dest.Platform, err)
	}

	return client, dest, accessToken, nil
}

func (m *Manager) handleMCPSetStreamInfo(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)
	userID := userIDFromCtx(ctx)

	title, _ := req.GetArguments()["title"].(string)
	category, _ := req.GetArguments()["category"].(string)

	if title == "" && category == "" {
		return mcp.NewToolResultError("at least one of title or category must be provided"), nil
	}

	client, dest, accessToken, err := m.resolvePlatformConnection(agentID, userID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := client.SetStreamInfo(ctx, accessToken, dest.PlatformUserID, title, category); err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to update stream info: %v", err)), nil
	}

	result := map[string]string{"status": "updated"}
	if title != "" {
		result["title"] = title
	}
	if category != "" {
		result["category"] = category
	}
	data, _ := json.Marshal(result)
	return mcp.NewToolResultText(string(data)), nil
}

func (m *Manager) handleMCPGetChat(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)
	userID := userIDFromCtx(ctx)

	limit := 20
	if v, ok := req.GetArguments()["limit"]; ok {
		if n, ok := v.(float64); ok && n > 0 {
			limit = int(n)
		}
	}
	if limit > 100 {
		limit = 100
	}

	client, dest, accessToken, err := m.resolvePlatformConnection(agentID, userID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	messages, err := client.GetChatMessages(ctx, accessToken, dest.PlatformUserID, limit)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to get chat: %v", err)), nil
	}

	data, _ := json.Marshal(messages)
	return mcp.NewToolResultText(string(data)), nil
}

func (m *Manager) handleMCPSendChat(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)
	userID := userIDFromCtx(ctx)

	message, err := req.RequireString("message")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	client, dest, accessToken, err := m.resolvePlatformConnection(agentID, userID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := client.SendChatMessage(ctx, accessToken, dest.PlatformUserID, message); err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to send chat: %v", err)), nil
	}

	result, _ := json.Marshal(map[string]string{"status": "sent", "platform": dest.Platform})
	return mcp.NewToolResultText(string(result)), nil
}
