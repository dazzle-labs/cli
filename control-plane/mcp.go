package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/mark3labs/mcp-go/mcp"
	"github.com/mark3labs/mcp-go/server"
)

// rendererJS is loaded from the runtime-scripts directory at startup.
// Set RUNTIME_SCRIPTS_DIR to override the default path (e.g. for local dev).
// In K8s this is mounted from the runtime-scripts ConfigMap at /app/runtime.
var rendererJS string

// runtimeScriptsDir is the directory containing runtime scripts (renderer.js, catalog files).
// Catalog files are re-read from this dir on each catalogRead call so hostPath changes are
// picked up without restarting the control-plane.
var runtimeScriptsDir string

func init() {
	runtimeScriptsDir = os.Getenv("RUNTIME_SCRIPTS_DIR")
	if runtimeScriptsDir == "" {
		runtimeScriptsDir = "/app/runtime"
	}
	path := runtimeScriptsDir + "/renderer.js"
	data, err := os.ReadFile(path)
	if err != nil {
		log.Printf("WARN: renderer.js not found at %s: %v", path, err)
		return
	}
	rendererJS = string(data)
	log.Printf("Loaded renderer.js (%d bytes) from %s", len(rendererJS), path)
}

// bootstrapped tracks which stages have had the scene runtime sent via set_script.
// obsConfigured tracks which stages have had OBS stream settings applied.
var (
	bootstrappedMu sync.Mutex
	bootstrapped   = map[string]bool{}

	obsConfiguredMu sync.Mutex
	obsConfigured   = map[string]bool{}
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
			mcp.WithDescription("Activate your stage. Call this before using any other tools. Returns status when ready. Your stage gives you a browser you can render content in, capture screenshots, and stream to platforms like Twitch and YouTube. Starting the stage does NOT begin streaming — use the obs tool with [\"st\", \"s\"] to go live when you're ready."),
		),
		m.handleMCPCreateStage,
	)

	s.AddTool(
		mcp.NewTool("stop",
			mcp.WithDescription("Deactivate your stage. Shuts down the browser and releases cloud resources. Call start to bring it back — stream destinations are preserved, but the scene spec will need to be re-set."),
		),
		m.handleMCPDestroyStage,
	)

	s.AddTool(
		mcp.NewTool("status",
			mcp.WithDescription("Get the current status of your stage (active/inactive/starting)."),
		),
		m.handleMCPStageStatus,
	)

	// ── Catalog tool ──

	s.AddTool(
		mcp.NewTool("catalogRead",
			mcp.WithDescription("Read the component catalog — lists available UI components, their props, and design guidelines. Call with detail=\"index\" for a compact list, or detail=\"full\" for the complete reference with all props and design principles. Start with \"full\" on your first call to learn the spec format."),
			mcp.WithString("detail", mcp.Description("Level of detail: \"index\" for component list, \"full\" for complete reference (default: \"full\")")),
		),
		handleMCPCatalogRead,
	)

	// ── Scene tools ──

	s.AddTool(
		mcp.NewTool("sceneSet",
			mcp.WithDescription("Set the full scene spec. Replaces the entire scene. The spec is a declarative UI description with elements, layout, and state bindings. Requires an active stage (call start first)."),
			mcp.WithObject("spec", mcp.Required(), mcp.Description("Scene spec object with root, elements, and state")),
		),
		m.handleMCPSceneSet,
	)

	s.AddTool(
		mcp.NewTool("scenePatch",
			mcp.WithDescription("Apply JSON Patch operations (RFC 6902) to the current scene. Supports add, replace, remove. Requires an active stage (call start first)."),
			mcp.WithArray("patches", mcp.Required(), mcp.Description("Array of JSON Patch operations, each with op, path, and optional value")),
		),
		m.handleMCPScenePatch,
	)

	s.AddTool(
		mcp.NewTool("stateSet",
			mcp.WithDescription("Update a value in the scene state by JSON Pointer path. Use \"/-\" suffix to append to an array. Requires an active stage (call start first)."),
			mcp.WithString("path", mcp.Required(), mcp.Description("JSON Pointer path within state, e.g. /events/- or /status/title")),
			mcp.WithString("value", mcp.Required(), mcp.Description("JSON-encoded value to set")),
		),
		m.handleMCPStateSet,
	)

	s.AddTool(
		mcp.NewTool("sceneRead",
			mcp.WithDescription("Read the current scene spec. Returns the full spec (root, elements, state). Requires an active stage (call start first)."),
		),
		m.handleMCPSceneRead,
	)

	// ── Timeline tools ──

	s.AddTool(
		mcp.NewTool("timelineAppend",
			mcp.WithDescription("Add one or more entries to the elapsed timeline. Entries are inserted in sorted order by `at` (elapsed ms). Each entry specifies a scene mutation (snapshot, patch, or stateSet) to fire at that presentation time. Requires an active stage (call start first)."),
			mcp.WithArray("entries", mcp.Required(), mcp.Description("Array of timeline entries. Each has `at` (elapsed ms), `action` (snapshot/patch/stateSet), optional `transition` and `label`.")),
		),
		m.handleMCPTimelineAppend,
	)

	s.AddTool(
		mcp.NewTool("timelinePlay",
			mcp.WithDescription("Start, pause, or stop timeline playback. Use seekTo to jump to a specific elapsed ms before playing. Requires an active stage (call start first)."),
			mcp.WithString("action", mcp.Required(), mcp.Description("Playback action: play, pause, or stop")),
			mcp.WithNumber("rate", mcp.Description("Playback speed multiplier, default 1.0")),
			mcp.WithNumber("seekTo", mcp.Description("Jump to this elapsed ms before playing")),
		),
		m.handleMCPTimelinePlay,
	)

	s.AddTool(
		mcp.NewTool("timelineRead",
			mcp.WithDescription("Read the current timeline state: entries, playback status, and elapsed position. Requires an active stage (call start first)."),
		),
		m.handleMCPTimelineRead,
	)

	s.AddTool(
		mcp.NewTool("timelineClear",
			mcp.WithDescription("Remove all timeline entries and reset playback. Requires an active stage (call start first)."),
		),
		m.handleMCPTimelineClear,
	)

	// ── Utility tools ──

	s.AddTool(
		mcp.NewTool("getLogs",
			mcp.WithDescription("Retrieve recent browser console logs (errors, warnings, info, debug). Returns the last N entries like tail. Requires an active stage (call start first)."),
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

		// Auth check — API key (bstr_) or Clerk JWT
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

	// Validate destination if one is configured — but don't block stage activation if none is set.
	// The harness and local dev often run without a stream destination.
	dest, destErr := m.validateStreamDestination(agentID, userID)

	waitCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	readyStage, err := m.activateStage(waitCtx, agentID, userID)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to activate stage: %v", err)), nil
	}

	// Configure OBS stream only if a valid destination was found and not already done
	obsConfiguredMu.Lock()
	alreadyConfigured := obsConfigured[agentID]
	obsConfiguredMu.Unlock()

	if dest != nil && destErr == nil && !alreadyConfigured {
		if err := m.configureOBSStream(readyStage, dest); err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("failed to configure stream: %v", err)), nil
		}
		obsConfiguredMu.Lock()
		obsConfigured[agentID] = true
		obsConfiguredMu.Unlock()
	} else if destErr != nil {
		log.Printf("Stage %s activated without stream destination: %v", agentID, destErr)
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
		return nil, fmt.Errorf("stream destination '%s' has no RTMP URL configured", dest.Name)
	}
	decryptedKey, err := decryptString(m.encryptionKey, dest.StreamKey)
	if err != nil {
		return nil, fmt.Errorf("stream destination '%s' has an invalid stream key: %w", dest.Name, err)
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
	log.Printf("Configuring OBS stream for stage %s (dest=%s, platform=%s)", stage.ID, dest.Name, dest.Platform)

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

// ── Internal pod helpers ──

// podSetScript sends a script to the streamer pod via POST /api/panel/main.
func (m *Manager) podSetScript(stage *Stage, script string) error {
	body, _ := json.Marshal(map[string]string{"script": script})
	podURL := fmt.Sprintf("http://%s:8080/api/panel/main?token=%s", stage.PodIP, url.QueryEscape(m.podToken))
	resp, err := http.Post(podURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to set script: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("pod returned %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// podEmitEvent sends an event to the streamer pod via POST /api/panel/main/event.
func (m *Manager) podEmitEvent(stage *Stage, event string, data any) error {
	body, _ := json.Marshal(map[string]any{"event": event, "data": data})
	podURL := fmt.Sprintf("http://%s:8080/api/panel/main/event?token=%s", stage.PodIP, url.QueryEscape(m.podToken))
	resp, err := http.Post(podURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("failed to emit event: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		respBody, _ := io.ReadAll(resp.Body)
		return fmt.Errorf("pod returned %d: %s", resp.StatusCode, string(respBody))
	}
	return nil
}

// podEval evaluates a JS expression in the browser via POST /api/panel/main/eval.
func (m *Manager) podEval(stage *Stage, expr string) (string, error) {
	body, _ := json.Marshal(map[string]string{"expr": expr})
	podURL := fmt.Sprintf("http://%s:8080/api/panel/main/eval?token=%s", stage.PodIP, url.QueryEscape(m.podToken))
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(podURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return "", fmt.Errorf("failed to eval: %v", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("pod returned %d: %s", resp.StatusCode, string(respBody))
	}
	return string(respBody), nil
}

// ensureBootstrapped sends the scene runtime bundle to the pod if not already done.
func (m *Manager) ensureBootstrapped(stage *Stage) error {
	bootstrappedMu.Lock()
	done := bootstrapped[stage.ID]
	bootstrappedMu.Unlock()
	if done {
		return nil
	}

	if rendererJS == "" {
		return fmt.Errorf("scene runtime not loaded — check RUNTIME_SCRIPTS_DIR or ConfigMap mount")
	}

	if err := m.podSetScript(stage, rendererJS); err != nil {
		return fmt.Errorf("failed to bootstrap scene runtime: %v", err)
	}

	bootstrappedMu.Lock()
	bootstrapped[stage.ID] = true
	bootstrappedMu.Unlock()
	log.Printf("Bootstrapped scene runtime on stage %s", stage.ID)
	return nil
}

// clearBootstrapped removes bootstrap and OBS state for a stage (called on deactivate).
func clearBootstrapped(stageID string) {
	bootstrappedMu.Lock()
	delete(bootstrapped, stageID)
	bootstrappedMu.Unlock()

	obsConfiguredMu.Lock()
	delete(obsConfigured, stageID)
	obsConfiguredMu.Unlock()
}

// ── Catalog tool handler ──

func handleMCPCatalogRead(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	detail := "full"
	if v, err := req.RequireString("detail"); err == nil && v != "" {
		detail = v
	}

	var filename string
	switch detail {
	case "index":
		filename = "catalog-index.md"
	default:
		filename = "catalog-full.md"
	}

	// Read from disk on each call so hostPath changes are picked up live.
	data, err := os.ReadFile(runtimeScriptsDir + "/" + filename)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("catalog not available (%s): %v", filename, err)), nil
	}
	return mcp.NewToolResultText(string(data)), nil
}

// ── Scene tool handlers ──

func (m *Manager) handleMCPSceneSet(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := m.ensureBootstrapped(stage); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	spec, ok := req.GetArguments()["spec"]
	if !ok {
		return mcp.NewToolResultError("spec is required"), nil
	}

	if err := m.podEmitEvent(stage, "scene:snapshot", map[string]any{"spec": spec}); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText("Scene set."), nil
}

func (m *Manager) handleMCPScenePatch(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := m.ensureBootstrapped(stage); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	patches, ok := req.GetArguments()["patches"]
	if !ok {
		return mcp.NewToolResultError("patches is required"), nil
	}

	if err := m.podEmitEvent(stage, "scene:patch", map[string]any{"patches": patches}); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText("Patches applied."), nil
}

func (m *Manager) handleMCPStateSet(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := m.ensureBootstrapped(stage); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	pathStr, err := req.RequireString("path")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	valueStr, err := req.RequireString("value")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	// Parse value as JSON
	var value any
	if err := json.Unmarshal([]byte(valueStr), &value); err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("value must be valid JSON: %v", err)), nil
	}

	if err := m.podEmitEvent(stage, "scene:stateSet", map[string]any{"path": pathStr, "value": value}); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("State updated at %s", pathStr)), nil
}

func (m *Manager) handleMCPSceneRead(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	result, err := m.podEval(stage, "JSON.stringify(window.__sceneSpec())")
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to read scene: %v", err)), nil
	}

	return mcp.NewToolResultText(result), nil
}

// ── Timeline tool handlers ──

func (m *Manager) handleMCPTimelineAppend(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := m.ensureBootstrapped(stage); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	entries, ok := req.GetArguments()["entries"]
	if !ok {
		return mcp.NewToolResultError("entries is required"), nil
	}

	if err := m.podEmitEvent(stage, "timeline:append", map[string]any{"entries": entries}); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText("Timeline entries appended."), nil
}

func (m *Manager) handleMCPTimelinePlay(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := m.ensureBootstrapped(stage); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	action, err := req.RequireString("action")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	data := map[string]any{"action": action}
	if rate, ok := req.GetArguments()["rate"]; ok {
		data["rate"] = rate
	}
	if seekTo, ok := req.GetArguments()["seekTo"]; ok {
		data["seekTo"] = seekTo
	}

	if err := m.podEmitEvent(stage, "timeline:play", data); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText(fmt.Sprintf("Timeline: %s", action)), nil
}

func (m *Manager) handleMCPTimelineRead(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	result, err := m.podEval(stage, "JSON.stringify(window.__timelineState())")
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to read timeline: %v", err)), nil
	}

	return mcp.NewToolResultText(result), nil
}

func (m *Manager) handleMCPTimelineClear(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := m.ensureBootstrapped(stage); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	if err := m.podEmitEvent(stage, "timeline:clear", map[string]any{}); err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	return mcp.NewToolResultText("Timeline cleared."), nil
}

// ── Utility tool handlers ──

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

	podURL := fmt.Sprintf("http://%s:8080/api/logs?limit=%d&token=%s", stage.PodIP, limit, url.QueryEscape(m.podToken))
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Get(podURL)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to get logs: %v", err)), nil
	}
	defer resp.Body.Close()
	respBody, err := io.ReadAll(resp.Body)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to read response: %v", err)), nil
	}

	if resp.StatusCode != http.StatusOK {
		return mcp.NewToolResultError(fmt.Sprintf("pod returned %d: %s", resp.StatusCode, string(respBody))), nil
	}

	return mcp.NewToolResultText(string(respBody)), nil
}

func (m *Manager) handleMCPScreenshot(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)

	stage, err := m.requireRunningStage(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	base64PNG, err := obsScreenshot(stage.PodIP)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("screenshot failed: %v", err)), nil
	}

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

	// Build gobs-cli command: prepend --host and --port, then user args
	cmdArgs := append([]string{"--host", stage.PodIP, "--port", "4455"}, args...)
	log.Printf("MCP obs: stage=%s cmd=gobs-cli %v", stage.ID, cmdArgs)

	cmd := exec.CommandContext(ctx, "gobs-cli", cmdArgs...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr

	if err := cmd.Run(); err != nil {
		errMsg := stderr.String()
		if errMsg == "" {
			errMsg = err.Error()
		}
		return mcp.NewToolResultError(fmt.Sprintf("gobs-cli error: %s", redactStreamSecrets(errMsg))), nil
	}

	output := stdout.String()
	if output == "" {
		output = "OK"
	}
	// Redact any stream credentials that might appear in output
	return mcp.NewToolResultText(redactStreamSecrets(output)), nil
}
