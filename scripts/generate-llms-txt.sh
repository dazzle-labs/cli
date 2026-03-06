#!/usr/bin/env bash
# Generate llms.txt from project sources of truth.
# Run from repo root: make llms-txt
#
# Sources:
#   - control-plane/mcp.go (MCP tool definitions, parsed via Go AST)
#   - web/src/components/onboarding/frameworks.ts (connection examples)
#   - Static sections for auth, stage lifecycle, API, OBS
#
# Sanity checks:
#   - Verifies mcp.go exists and parses
#   - Verifies expected tools are present in output
#   - Verifies framework examples extract successfully
#   - Fails loudly on any error

set -euo pipefail
cd "$(dirname "$0")/.."

MCP_GO="control-plane/mcp.go"
FRAMEWORKS_TS="web/src/components/onboarding/frameworks.ts"

# --- Sanity checks ---
if [ ! -f "$MCP_GO" ]; then
  echo "ERROR: $MCP_GO not found" >&2
  exit 1
fi
if [ ! -f "$FRAMEWORKS_TS" ]; then
  echo "ERROR: $FRAMEWORKS_TS not found" >&2
  exit 1
fi

# Extract MCP tools via Go AST parser
MCP_TOOLS_MD=$(go run scripts/extract-mcp-tools.go 2>&1)
if [ $? -ne 0 ]; then
  echo "ERROR: Go AST extraction failed:" >&2
  echo "$MCP_TOOLS_MD" >&2
  exit 1
fi

# Verify expected tools are present
for tool in start stop status set_script get_script edit_script emit_event screenshot obs; do
  if ! echo "$MCP_TOOLS_MD" | grep -q "^#### $tool\$"; then
    echo "ERROR: Expected tool '$tool' not found in extracted output" >&2
    exit 1
  fi
done

TOOL_COUNT=$(echo "$MCP_TOOLS_MD" | grep -c "^#### " || true)
if [ "$TOOL_COUNT" -lt 9 ]; then
  echo "ERROR: Expected at least 9 tools, found $TOOL_COUNT" >&2
  exit 1
fi

# Extract framework connection examples
FRAMEWORKS_MD=$(node scripts/extract-frameworks.cjs 2>&1)
if [ $? -ne 0 ]; then
  echo "ERROR: Framework extraction failed:" >&2
  echo "$FRAMEWORKS_MD" >&2
  exit 1
fi

FRAMEWORK_COUNT=$(echo "$FRAMEWORKS_MD" | grep -c "^\*\*" || true)
if [ "$FRAMEWORK_COUNT" -lt 3 ]; then
  echo "ERROR: Expected at least 3 frameworks, found $FRAMEWORK_COUNT" >&2
  exit 1
fi

# --- Generate output ---

cat <<'HEADER'
# Dazzle (Browser Streamer)

> On-demand cloud browser environments for AI agents and live streaming.
> Production: https://stream.dazzle.fm

## Overview

Dazzle provides isolated browser stages — each is a Kubernetes pod running Chrome on a headless display with OBS for streaming. Stages are controlled via an MCP (Model Context Protocol) server, Chrome DevTools Protocol (CDP), and a web dashboard.

Primary use cases: AI agents that need a persistent browser, live streaming to Twitch/YouTube/Kick via RTMP, and programmatic browser automation.

## Getting Started

Follow these steps to get your agent connected and streaming:

### 1. Create an account

Sign up at https://stream.dazzle.fm — authentication is handled by Clerk.

### 2. Create a stage

A stage is your isolated browser environment. Create one from the dashboard, or via the API:
```
POST https://stream.dazzle.fm/api.v1.StageService/CreateStage
Authorization: Bearer <your-jwt-or-api-key>
Content-Type: application/json

{"name": "my-stage"}
```
This returns a stage object with an `id` (UUID). The stage starts as `inactive`.

### 3. Get an API key

Create an API key from the dashboard (Settings > API Keys). Keys are in `bstr_<secret>` format. Store it securely — the full key is only shown once.

Set it as an environment variable:
```bash
export DAZZLE_API_KEY=bstr_your_key_here
```

### 4. Connect your MCP client

Your stage's MCP endpoint is:
```
POST https://stream.dazzle.fm/stage/<stage-uuid>/mcp
Protocol: StreamableHTTP (MCP over HTTP)
Authorization: Bearer <your-api-key>
```

Here are examples for popular frameworks:

HEADER

echo "$FRAMEWORKS_MD"

cat <<'MIDDLE'
### 5. Activate and use your stage

Once connected, call the `start` tool to activate your stage. This provisions a browser pod. Then:

1. **Render content** — use `set_script` to push JavaScript/JSX to the browser
2. **Go live** — use `obs` with args `["st", "s"]` to start streaming (requires a stream destination)
3. **Monitor** — use `screenshot` to see what's on screen, `get_logs` for console output

### 6. (Optional) Add a stream destination

To stream to Twitch, YouTube, Kick, etc., add a destination from the dashboard or via the API before going live. Stream destinations are linked to stages and configured automatically in OBS.

## Authentication

All API and MCP requests require:
```
Authorization: Bearer <token>
```
Where `<token>` is either:
- **Clerk JWT** — from the web dashboard
- **API Key** — `bstr_<secret>` format, created via the dashboard

## MCP Server

### Endpoint
```
POST /stage/<stage-uuid>/mcp
Protocol: StreamableHTTP (MCP over HTTP)
Auth: Clerk JWT or API key
```

The stage UUID is your stage's ID. You must call `start` before using any other tools.

### Tools

MIDDLE

echo "$MCP_TOOLS_MD"

cat <<'STAGE'
## Stage Lifecycle

```
inactive → starting → running → stopping → inactive
```

- `start` — creates a pod, waits for readiness, configures OBS stream
- `stop` — tears down the pod, keeps the stage record
- `status` — check current state

Stages persist across pod restarts. The control plane recovers running pods on startup.

STAGE

cat <<'API'
## ConnectRPC API

Base URL: `https://stream.dazzle.fm` (or `http://localhost:8080` for local dev)

All services use `POST /api.v1.<Service>/<Method>` with JSON or Protobuf body.

### StageService (JWT or API key)

| Method | Description |
|--------|-------------|
| `CreateStage` | Create a stage (returns inactive, call `start` MCP tool to activate) |
| `ListStages` | List all stages owned by the authenticated user |
| `GetStage` | Get stage details by ID |
| `DeleteStage` | Delete a stage (stops pod if active) |
| `SetStageDestination` | Link a stream destination to a stage |

### ApiKeyService (JWT only)

| Method | Description |
|--------|-------------|
| `CreateApiKey` | Create a new API key (`bstr_*` format). Full key shown only once. |
| `ListApiKeys` | List all API keys (prefixes only) |
| `DeleteApiKey` | Delete an API key by ID |

### RtmpDestinationService (JWT only)

| Method | Description |
|--------|-------------|
| `CreateStreamDestination` | Create a stream destination (Twitch, YouTube, Kick, etc.) |
| `ListStreamDestinations` | List destinations for a stage |
| `UpdateStreamDestination` | Update destination settings |
| `DeleteStreamDestination` | Delete a destination |

### UserService (JWT only)

| Method | Description |
|--------|-------------|
| `GetProfile` | Get user profile with stage and API key counts |

## CDP Access

```
GET  /stage/<id>/cdp/json/version   — Chrome version info
GET  /stage/<id>/cdp/json           — Tab list
WS   /stage/<id>/cdp                — Full CDP WebSocket proxy
```

WebSocket URLs in responses are rewritten to route through the control plane.

API

cat <<'OBS'
## OBS Control

The `obs` tool wraps `gobs-cli` and supports all OBS WebSocket v5 commands:

| Command | Example args |
|---------|-------------|
| Start streaming | `["st", "s"]` |
| Stop streaming | `["st", "st"]` |
| Stream status | `["st", "ss"]` |
| List scenes | `["sc", "ls"]` |
| Screenshot to file | `["ss", "sv", "--source=Scene", "--path=/tmp/shot.png"]` |
| Start recording | `["rec", "s"]` |
| List inputs | `["i", "ls"]` |

Stream service settings (RTMP URL, stream key) are managed automatically and cannot be read by agents.

## Typical Workflow

```
1. start              → Provision browser pod
2. set_script          → Render content (JS/JSX, hot-swapped via HMR)
3. screenshot          → Verify output looks correct
4. obs ["st", "s"]     → Go live on configured stream destination
5. edit_script / emit_event → Update content live without reload
6. obs ["st", "st"]    → Stop streaming
7. stop                → Release resources
```
OBS
