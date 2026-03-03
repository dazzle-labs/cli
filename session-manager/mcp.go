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
		mcp.NewTool("create_stage",
			mcp.WithDescription("Create and start the agent's stage — a browser streaming environment with Chrome, OBS Studio, and a Node.js server. You must create a stage before using any other tools. Returns status when ready."),
		),
		m.handleMCPCreateStage,
	)

	s.AddTool(
		mcp.NewTool("destroy_stage",
			mcp.WithDescription("Tear down the agent's stage and all its processes. The stage cannot be used after this."),
		),
		m.handleMCPDestroyStage,
	)

	s.AddTool(
		mcp.NewTool("stage_status",
			mcp.WithDescription("Get the current status of the agent's stage (running/stopped/starting)."),
		),
		m.handleMCPStageStatus,
	)

	s.AddTool(
		mcp.NewTool("set_html",
			mcp.WithDescription("Set HTML content to render in the session's Chrome browser. Stores the HTML and navigates Chrome to display it. Requires an active stage (call create_stage first)."),
			mcp.WithString("html", mcp.Required(), mcp.Description("HTML content to render")),
			mcp.WithString("panel", mcp.Description("Panel name (default: main). Use with layout tool to target specific panels in multi-panel layouts.")),
		),
		m.handleMCPSetHTML,
	)

	s.AddTool(
		mcp.NewTool("get_html",
			mcp.WithDescription("Get the current HTML content being rendered in the session's Chrome browser. Requires an active stage (call create_stage first)."),
			mcp.WithString("panel", mcp.Description("Panel name (default: main). Use with layout tool to target specific panels in multi-panel layouts.")),
		),
		m.handleMCPGetHTML,
	)

	s.AddTool(
		mcp.NewTool("edit_html",
			mcp.WithDescription("Edit the current HTML content by finding and replacing a string. The old_string must exist exactly once in the current HTML. Requires an active stage (call create_stage first)."),
			mcp.WithString("old_string", mcp.Required(), mcp.Description("The exact string to find in the current HTML")),
			mcp.WithString("new_string", mcp.Required(), mcp.Description("The replacement string")),
			mcp.WithString("panel", mcp.Description("Panel name (default: main). Use with layout tool to target specific panels in multi-panel layouts.")),
		),
		m.handleMCPEditHTML,
	)

	s.AddTool(
		mcp.NewTool("layout",
			mcp.WithDescription(`Get or set the multi-panel layout. Requires an active stage (call create_stage first).

Presets create named panels you can target with set_html/edit_html/get_html(panel: "<name>"):
- "single" — one full-screen panel named "main" (the default layout)
- "split" — two side-by-side panels named "left" and "right"
- "grid-2x2" — four equal panels named "top-left", "top-right", "bottom-left", "bottom-right"
- "pip" — large panel "main" with small overlay "pip" in the bottom-right corner

You can override default panel names with the names param (e.g. preset="split", names=["code","preview"]).

For fully custom layouts, pass specs as a JSON array of panel definitions with percentage-based positioning:
[{"name":"cam","x":0,"y":0,"width":30,"height":100},{"name":"slides","x":30,"y":0,"width":70,"height":100}]

Call with no params to read the current layout and see which panels are available.`),
			mcp.WithString("preset", mcp.Description("Layout preset: single, split, grid-2x2, or pip")),
			mcp.WithArray("names", mcp.Description("Custom panel names for the preset slots (e.g. [\"cam\", \"slides\"] for split)")),
			mcp.WithString("specs", mcp.Description("JSON array of {name, x, y, width, height} for custom layouts (each value 0-100 as percentage)")),
		),
		m.handleMCPLayout,
	)

	s.AddTool(
		mcp.NewTool("screenshot",
			mcp.WithDescription("Capture a screenshot of the OBS stream output as a PNG image. Requires an active stage (call create_stage first)."),
		),
		m.handleMCPScreenshot,
	)

	s.AddTool(
		mcp.NewTool("gobs",
			mcp.WithDescription(`Run OBS command via gobs-cli. Args passed directly (no shell). Requires an active stage (call create_stage first). Use shorthands to save tokens.

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
			mcp.WithArray("args", mcp.Required(), mcp.Description("gobs-cli args, e.g. [\"st\", \"s\"] to start streaming.")),
		),
		m.handleMCPGobs,
	)

	return server.NewStreamableHTTPServer(s)
}

// mcpMiddleware validates auth, extracts the agent UUID from the URL path,
// strips the /<uuid> prefix so the MCP handler sees /mcp/..., and stores
// the UUID in request context.
func (m *Manager) mcpMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Path format: /mcp/<uuid> or /mcp/<uuid>/...
		trimmed := strings.TrimPrefix(r.URL.Path, "/mcp/")
		if trimmed == r.URL.Path {
			// No /mcp/ prefix — reject
			http.NotFound(w, r)
			return
		}

		parts := strings.SplitN(trimmed, "/", 2)
		agentID := parts[0]
		if agentID == "" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusBadRequest)
			w.Write([]byte(`{"error":"agent UUID required in path: /mcp/<uuid>"}`))
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

		// Ensure user exists in DB for session tracking
		if m.db != nil && info.Method == authMethodClerk {
			dbUpsertUser(m.db, info.UserID, "", "")
		}

		// Validate endpoint UUID exists and belongs to the authenticated user
		if m.db != nil {
			endpoint, err := dbGetEndpoint(m.db, agentID)
			if err != nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte(`{"error":"internal error"}`))
				return
			}
			if endpoint == nil {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusNotFound)
				w.Write([]byte(`{"error":"endpoint not found"}`))
				return
			} else if endpoint.UserID != info.UserID {
				w.Header().Set("Content-Type", "application/json")
				w.WriteHeader(http.StatusNotFound)
				w.Write([]byte(`{"error":"endpoint not found"}`))
				return
			}
		}

		// Rewrite path: strip the /<uuid> segment so MCP handler sees /mcp or /mcp/...
		if len(parts) > 1 {
			r.URL.Path = "/mcp/" + parts[1]
		} else {
			r.URL.Path = "/mcp"
		}

		// Store agent ID and user ID in context
		ctx := context.WithValue(r.Context(), agentIDKey, agentID)
		ctx = context.WithValue(ctx, userIDKey, info.UserID)
		next.ServeHTTP(w, r.WithContext(ctx))
	})
}

// requireRunningSession resolves the agent's session and verifies it is running.
func (m *Manager) requireRunningSession(ctx context.Context, agentID string) (*Session, error) {
	sess, ok := m.getSession(agentID)
	if !ok {
		return nil, fmt.Errorf("no session for agent %s — call create_stage first", agentID)
	}
	if sess.PodIP == "" || sess.Status != StatusRunning {
		return nil, fmt.Errorf("session %s not ready (status: %s)", agentID, sess.Status)
	}

	return sess, nil
}

func (m *Manager) handleMCPCreateStage(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)
	if agentID == "" {
		return mcp.NewToolResultError("agent ID not found in request context"), nil
	}

	// Check if session already exists and is running
	if sess, ok := m.getSession(agentID); ok {
		if sess.Status == StatusRunning && sess.PodIP != "" {
			result, _ := json.Marshal(map[string]any{
				"status":  "already_running",
				"message": "session is already running",
			})
			return mcp.NewToolResultText(string(result)), nil
		}
		if sess.Status == StatusStarting {
			// Wait for existing starting session
			waitCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
			defer cancel()
			readySess, err := m.waitForSession(waitCtx, agentID)
			if err != nil {
				return mcp.NewToolResultError(fmt.Sprintf("session starting but not ready: %v", err)), nil
			}
			result, _ := json.Marshal(map[string]any{
				"status": string(readySess.Status),
			})
			return mcp.NewToolResultText(string(result)), nil
		}
	}

	sess, err := m.createSession(agentID)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to create session: %v", err)), nil
	}

	// Log session to DB for recovery across deploys
	userID := userIDFromCtx(ctx)
	sess.OwnerUserID = userID
	if m.db != nil && userID != "" {
		dbLogSessionCreate(m.db, sess.ID, userID, sess.PodName)
	}

	// Wait for session to be ready (up to 60s)
	waitCtx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()

	readySess, err := m.waitForSession(waitCtx, sess.ID)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("session created but not ready: %v", err)), nil
	}

	// Configure OBS with user's stream destinations
	m.configureOBSStream(readySess, userIDFromCtx(ctx))

	result, _ := json.Marshal(map[string]any{
		"status": string(readySess.Status),
	})
	return mcp.NewToolResultText(string(result)), nil
}

const defaultRTMPURL = "rtmps://fa723fc1b171.global-contribute.live-video.net"

// configureOBSStream sets OBS stream settings from the user's first enabled stream destination.
// Falls back to the default RTMP URL (without a key) if no destinations are configured.
func (m *Manager) configureOBSStream(sess *Session, userID string) {
	var rtmpURL, streamKey string

	if m.db != nil && userID != "" {
		dests, err := dbListStreamDests(m.db, userID)
		if err != nil {
			log.Printf("WARN: failed to list stream destinations for user %s: %v", userID, err)
		} else {
			for i := range dests {
				if dests[i].Enabled {
					rtmpURL = dests[i].RtmpURL
					key, err := decryptString(m.encryptionKey, dests[i].StreamKey)
					if err != nil {
						log.Printf("WARN: failed to decrypt stream key for dest %s: %v", dests[i].ID, err)
					} else {
						streamKey = key
					}
					log.Printf("Configuring OBS stream for session %s (dest=%s, platform=%s)", sess.ID, dests[i].Name, dests[i].Platform)
					break
				}
			}
		}
	}

	if rtmpURL == "" {
		rtmpURL = defaultRTMPURL
		log.Printf("Configuring OBS stream for session %s with default RTMP URL", sess.ID)
	}

	args := []string{
		"--host", sess.PodIP, "--port", "4455",
		"settings", "stream-service", "rtmp_custom",
		"--server", rtmpURL,
	}
	if streamKey != "" {
		args = append(args, "--key", streamKey)
	}

	cmd := exec.CommandContext(context.Background(), "gobs-cli", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		log.Printf("WARN: failed to configure OBS stream settings: %v (%s)", err, stderr.String())
	}
}

func (m *Manager) handleMCPDestroyStage(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)
	if agentID == "" {
		return mcp.NewToolResultError("agent ID not found in request context"), nil
	}

	if _, ok := m.getSession(agentID); !ok {
		return mcp.NewToolResultText(`{"status":"already_stopped"}`), nil
	}

	if err := m.deleteSession(agentID); err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to stop session: %v", err)), nil
	}

	return mcp.NewToolResultText(`{"status":"stopped"}`), nil
}

func (m *Manager) handleMCPStageStatus(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)
	if agentID == "" {
		return mcp.NewToolResultError("agent ID not found in request context"), nil
	}

	sess, ok := m.getSession(agentID)
	if !ok {
		result, _ := json.Marshal(map[string]any{
			"status": "stopped",
		})
		return mcp.NewToolResultText(string(result)), nil
	}

	result, _ := json.Marshal(map[string]any{
		"status": string(sess.Status),
	})
	return mcp.NewToolResultText(string(result)), nil
}

// panelEndpoint returns the pod URL path for HTML operations.
// If panel is non-empty, uses /api/panel/:name; otherwise /api/template (backward compat).
func panelEndpoint(panel, suffix string) string {
	if panel != "" {
		path := "/api/panel/" + url.PathEscape(panel)
		if suffix != "" {
			path += "/" + suffix
		}
		return path
	}
	path := "/api/template"
	if suffix != "" {
		path += "/" + suffix
	}
	return path
}

func (m *Manager) handleMCPSetHTML(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)
	html, err := req.RequireString("html")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	panel, _ := req.RequireString("panel")

	sess, err := m.requireRunningSession(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	body, _ := json.Marshal(map[string]string{"html": html})
	podURL := fmt.Sprintf("http://%s:8080%s?token=%s", sess.PodIP, panelEndpoint(panel, ""), url.QueryEscape(m.podToken))
	resp, err := http.Post(podURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to set template: %v", err)), nil
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return mcp.NewToolResultError(fmt.Sprintf("pod returned %d: %s", resp.StatusCode, string(respBody))), nil
	}

	return mcp.NewToolResultText(string(respBody)), nil
}

func (m *Manager) handleMCPGetHTML(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)
	panel, _ := req.RequireString("panel")

	sess, err := m.requireRunningSession(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	podURL := fmt.Sprintf("http://%s:8080%s?token=%s", sess.PodIP, panelEndpoint(panel, ""), url.QueryEscape(m.podToken))
	resp, err := http.Get(podURL)
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to get template: %v", err)), nil
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	return mcp.NewToolResultText(string(respBody)), nil
}

func (m *Manager) handleMCPEditHTML(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)
	oldString, err := req.RequireString("old_string")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	newString, err := req.RequireString("new_string")
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}
	panel, _ := req.RequireString("panel")

	sess, err := m.requireRunningSession(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	body, _ := json.Marshal(map[string]string{"old_string": oldString, "new_string": newString})
	podURL := fmt.Sprintf("http://%s:8080%s?token=%s", sess.PodIP, panelEndpoint(panel, "edit"), url.QueryEscape(m.podToken))
	resp, err := http.Post(podURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to edit template: %v", err)), nil
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return mcp.NewToolResultError(fmt.Sprintf("pod returned %d: %s", resp.StatusCode, string(respBody))), nil
	}

	return mcp.NewToolResultText(string(respBody)), nil
}

func (m *Manager) handleMCPLayout(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)

	sess, err := m.requireRunningSession(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	preset, _ := req.RequireString("preset")
	specs, _ := req.RequireString("specs")

	// Extract names array if provided
	var names []string
	if argsMap := req.GetArguments(); argsMap != nil {
		if namesRaw, ok := argsMap["names"]; ok && namesRaw != nil {
			if namesSlice, ok := namesRaw.([]interface{}); ok {
				for _, n := range namesSlice {
					if s, ok := n.(string); ok {
						names = append(names, s)
					}
				}
			}
		}
	}

	baseURL := fmt.Sprintf("http://%s:8080/api/layout?token=%s", sess.PodIP, url.QueryEscape(m.podToken))

	// If neither preset nor specs provided, GET current layout
	if preset == "" && specs == "" {
		resp, err := http.Get(baseURL)
		if err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("failed to get layout: %v", err)), nil
		}
		defer resp.Body.Close()
		respBody, _ := io.ReadAll(resp.Body)
		return mcp.NewToolResultText(string(respBody)), nil
	}

	// Build POST body
	payload := map[string]any{}
	if preset != "" {
		payload["preset"] = preset
		if len(names) > 0 {
			payload["names"] = names
		}
	} else if specs != "" {
		// Parse specs JSON string into array
		var specsArr []map[string]any
		if err := json.Unmarshal([]byte(specs), &specsArr); err != nil {
			return mcp.NewToolResultError(fmt.Sprintf("invalid specs JSON: %v", err)), nil
		}
		payload["specs"] = specsArr
	}

	body, _ := json.Marshal(payload)
	resp, err := http.Post(baseURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return mcp.NewToolResultError(fmt.Sprintf("failed to set layout: %v", err)), nil
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode != http.StatusOK {
		return mcp.NewToolResultError(fmt.Sprintf("pod returned %d: %s", resp.StatusCode, string(respBody))), nil
	}

	return mcp.NewToolResultText(string(respBody)), nil
}

func (m *Manager) handleMCPScreenshot(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
	agentID := agentIDFromCtx(ctx)

	sess, err := m.requireRunningSession(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	base64PNG, err := obsScreenshot(sess.PodIP)
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

// gobsBlockedCommands are subcommand sequences that could expose stream credentials.
// The agent should never be able to read the RTMP URL or stream key.
// Includes both full names and shorthands.
var gobsBlockedCommands = [][]string{
	{"settings", "stream-service"},
	{"settings", "ss"},
	{"set", "stream-service"},
	{"set", "ss"},
}

// redactStreamSecrets removes RTMP URLs and stream-key-like values from gobs output.
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

// isBlockedGobsCommand checks if the args match any blocked command prefix.
func isBlockedGobsCommand(args []string) bool {
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

	for _, blocked := range gobsBlockedCommands {
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

func (m *Manager) handleMCPGobs(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
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
	if isBlockedGobsCommand(args) {
		return mcp.NewToolResultError("access denied: stream service settings contain credentials and cannot be read. Stream configuration is managed automatically."), nil
	}

	sess, err := m.requireRunningSession(ctx, agentID)
	if err != nil {
		return mcp.NewToolResultError(err.Error()), nil
	}

	// Build gobs-cli command: prepend --host and --port, then user args
	cmdArgs := append([]string{"--host", sess.PodIP, "--port", "4455"}, args...)
	log.Printf("MCP gobs: session=%s cmd=gobs-cli %v", sess.ID, cmdArgs)

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
