# Dazzle CLI Design

## Overview

Public CLI for Dazzle — the **primary interface** for developers and AI agents. All stage lifecycle, scripting, screenshots, OBS, and streaming operations are available via ConnectRPC calls to the control-plane. Ships as a separate repo, git submodule'd into agent-streamer. Supersedes the legacy MCP integration.

## CLI Commands

```
dazzle login                          # Device-flow auth via browser
dazzle logout                         # Clear stored credentials
dazzle whoami                         # Show current user

dazzle stage list                     # List stages
dazzle stage create [name]            # Create stage record
dazzle stage delete <id|name>         # Delete stage record
dazzle stage start [id|name]          # Activate stage (spin up pod)
dazzle stage stop [id|name]           # Deactivate stage (tear down pod)
dazzle stage status [id|name]         # Get current status
dazzle stage use <id|name>            # Set default stage in ~/.config/dazzle/

dazzle script set <file>              # Set script from file (- for stdin)
dazzle script get                     # Print current script to stdout
dazzle script edit --old "x" --new "y"  # Find/replace in live script

dazzle emit <event-name> <json>       # Push event to running script
dazzle logs [--limit N] [--follow]    # Browser console logs
dazzle screenshot [--out file.png]    # Capture screenshot (default: open in viewer)

dazzle obs <args...>                  # OBS control passthrough (same arg format as MCP)

dazzle destination list               # List RTMP destinations
dazzle destination create             # Interactive create
dazzle destination delete <id|name>   # Delete destination
dazzle destination set <id|name>      # Assign destination to current stage
```

### Stage resolution order
1. `--stage` flag (on any stage-scoped command)
2. `DAZZLE_STAGE` env var
3. Default from `~/.config/dazzle/config.json` (set via `dazzle stage use`)
4. Auto-select if user has exactly one stage

### Config files
```
~/.config/dazzle/
  credentials.json    # { "api_key": "bstr_...", "api_url": "https://api.dazzle.fm" }
  config.json         # { "default_stage": "...", "api_url": "..." }
```

## Auth: Device Authorization Flow

Similar to `gh auth login` / `fly auth login`.

### Flow
1. User runs `dazzle login`
2. CLI calls `POST /auth/device` (REST, no auth required) -> `{ device_code, user_code, verification_url, expires_in, interval }`
3. CLI prints:
   ```
   Open this URL to authenticate:
     https://dazzle.fm/cli/login

   Enter code: ABCD-1234

   Waiting for authentication...
   ```
4. CLI also attempts to open the URL in the default browser
5. User visits URL, logs in via Clerk, enters the code (or URL has code pre-filled)
6. Web app verifies the code, creates an API key named "Dazzle CLI", marks device code as complete
7. CLI polls `POST /auth/device/token` with `device_code` -> eventually gets `{ api_key: "bstr_..." }`
8. CLI stores API key in `~/.config/dazzle/credentials.json`

### Why device flow over direct API key copy-paste?
- Better UX (no manual copy-paste of secrets)
- Familiar pattern (GitHub CLI, Fly.io, etc.)
- API key is only ever transmitted server-to-CLI, never displayed in browser
- Can show "CLI (device-name)" in the API keys list for easy revocation

### Server-side additions
- New DB table `device_auth_codes` (device_code, user_code, user_id, api_key_id, status, expires_at)
- REST endpoints (not gRPC — pre-auth, simple request/response):
  - `POST /auth/device` — create device code (no auth)
  - `POST /auth/device/token` — poll for completion (no auth, uses device_code)
  - `POST /auth/device/complete` — called by web app after user authenticates (Clerk auth)
- Web page at `/cli/login` — Clerk-gated page with code entry form

## Proto Service Changes

### Expand StageService (stage.proto)
Add activate/deactivate RPCs to existing service:

```protobuf
service StageService {
  // Existing
  rpc CreateStage(CreateStageRequest) returns (CreateStageResponse);
  rpc ListStages(ListStagesRequest) returns (ListStagesResponse);
  rpc GetStage(GetStageRequest) returns (GetStageResponse);
  rpc DeleteStage(DeleteStageRequest) returns (DeleteStageResponse);
  rpc SetStageDestination(SetStageDestinationRequest) returns (SetStageDestinationResponse);

  // New — runtime lifecycle
  rpc ActivateStage(ActivateStageRequest) returns (ActivateStageResponse);
  rpc DeactivateStage(DeactivateStageRequest) returns (DeactivateStageResponse);
}

message ActivateStageRequest {
  string id = 1;
}

message ActivateStageResponse {
  Stage stage = 1;
}

message DeactivateStageRequest {
  string id = 1;
}

message DeactivateStageResponse {
  Stage stage = 1;
}
```

### New RuntimeService (runtime.proto)
All stage-scoped interactive operations. Every request takes a `stage_id`.

```protobuf
service RuntimeService {
  rpc SetScript(SetScriptRequest) returns (SetScriptResponse);
  rpc GetScript(GetScriptRequest) returns (GetScriptResponse);
  rpc EditScript(EditScriptRequest) returns (EditScriptResponse);
  rpc EmitEvent(EmitEventRequest) returns (EmitEventResponse);
  rpc GetLogs(GetLogsRequest) returns (GetLogsResponse);
  rpc Screenshot(ScreenshotRequest) returns (ScreenshotResponse);
  rpc ObsCommand(ObsCommandRequest) returns (ObsCommandResponse);
}

message SetScriptRequest {
  string stage_id = 1;
  string script = 2;
}

message SetScriptResponse {
  bool ok = 1;
}

message GetScriptRequest {
  string stage_id = 1;
}

message GetScriptResponse {
  string script = 1;
}

message EditScriptRequest {
  string stage_id = 1;
  string old_string = 2;
  string new_string = 3;
}

message EditScriptResponse {
  bool ok = 1;
}

message EmitEventRequest {
  string stage_id = 1;
  string event = 2;
  string data = 3; // JSON string
}

message EmitEventResponse {
  bool ok = 1;
}

message GetLogsRequest {
  string stage_id = 1;
  int32 limit = 2; // default 100, max 1000
}

message LogEntry {
  string level = 1;
  string message = 2;
  string timestamp = 3;
}

message GetLogsResponse {
  repeated LogEntry entries = 1;
}

message ScreenshotRequest {
  string stage_id = 1;
}

message ScreenshotResponse {
  bytes image = 1; // PNG bytes
}

message ObsCommandRequest {
  string stage_id = 1;
  repeated string args = 2;
}

message ObsCommandResponse {
  string output = 1;
}
```

### Auth scope changes
- `StageService` — Clerk JWT or API key (already, plus new activate/deactivate)
- `RuntimeService` — Clerk JWT or API key
- `ApiKeyService` — Clerk JWT only (unchanged)
- `RtmpDestinationService` — Clerk JWT or API key (change from Clerk-only, so CLI can manage destinations)
- `UserService` — Clerk JWT or API key (change from Clerk-only, for `dazzle whoami`)

## MCP (legacy)

MCP is being superseded by the CLI. The MCP endpoint remains functional for backward compatibility but is no longer the recommended integration path. All operations available via MCP are accessible through `dazzle` CLI commands.

After the RuntimeService exists, MCP handlers become thin wrappers that call the same business logic as the Connect handlers.

### Shared interface approach
```go
// runtimeOps is the internal interface both MCP and Connect call into.
type runtimeOps interface {
    SetScript(ctx context.Context, stageID, script string) error
    GetScript(ctx context.Context, stageID string) (string, error)
    EditScript(ctx context.Context, stageID, old, new string) error
    EmitEvent(ctx context.Context, stageID, event, data string) error
    GetLogs(ctx context.Context, stageID string, limit int) ([]LogEntry, error)
    Screenshot(ctx context.Context, stageID string) ([]byte, error)
    ObsCommand(ctx context.Context, stageID string, args []string) (string, error)
    ActivateStage(ctx context.Context, stageID, userID string) (*Stage, error)
    DeactivateStage(ctx context.Context, stageID string) error
}
```

Both `runtimeServer` (Connect) and MCP handlers call this interface on the Manager.

## CLI Tech Stack

- Go, single binary
- [cobra](https://github.com/spf13/cobra) for CLI framework
- [connectrpc.com/connect](https://connectrpc.com) client for RPC calls
- Generated proto client code (buf generate with connect-go plugin)
- `os/exec` + `open` for browser launch during login
- Proto definitions imported from agent-streamer (or vendored via buf)

## Implementation Order

1. **Proto definitions** — Add `ActivateStage`/`DeactivateStage` to stage.proto, create runtime.proto
2. **Generate code** — `make proto` (Go + TypeScript)
3. **Shared interface** — Extract `runtimeOps` from Manager, implement methods
4. **Connect handlers** — `connect_runtime.go` implementing RuntimeService, expand stage server
5. **Refactor MCP** — Make MCP handlers call through runtimeOps
6. **Device auth** — DB table, REST endpoints, web page
7. **CLI repo** — Init Go module, cobra commands, connect client, device auth flow
8. **Git submodule** — Add CLI repo as submodule

## Open Questions

1. **CLI repo name/org** — `dazzle-io/cli`? `dazzle-fm/dazzle`?
2. **Proto sharing** — Should the CLI repo vendor the proto files, or use buf BSR?
3. **Streaming logs** — Should `GetLogs` support server-streaming for `--follow`? (Can add later)
4. **Screenshot display** — On macOS, open in Preview? Or just save to file?
5. **API URL** — Default to `https://api.dazzle.fm`? Configurable for local dev?
