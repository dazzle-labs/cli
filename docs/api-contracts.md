# API Contracts

**Last updated:** 2026-03-03

All control plane RPC services use **ConnectRPC** (protobuf over HTTP/2, also compatible with HTTP/1.1 JSON). Base URL: `https://stream.dazzle.fm`

---

## Authentication

All authenticated endpoints require:
```
Authorization: Bearer <token>
```

Where `<token>` is either:
- **Clerk JWT** — obtained from `clerk.session.getToken()` in the frontend
- **API Key** — `bstr_<secret>` format; accepted by StageService only (not ApiKeyService, StreamService, UserService)

---

## StageService

Accepts Clerk JWT **or** API key.

### CreateStage
```
POST /api.v1.StageService/CreateStage

Request:  { "name": string }
Response: { "stage": Stage }
```
Creates a persistent stage record (status: `inactive`). Does not provision a pod.

### ListStages
```
POST /api.v1.StageService/ListStages

Request:  {}
Response: { "stages": Stage[] }
```

### GetStage
```
POST /api.v1.StageService/GetStage

Request:  { "id": string }
Response: { "stage": Stage }
```
Activates the stage if inactive (creates pod, waits for readiness). Returns stage with current status and pod IP.

### DeleteStage
```
POST /api.v1.StageService/DeleteStage

Request:  { "id": string }
Response: {}
```
Deletes pod (if active) and DB record.

### Stage Object

```typescript
interface Stage {
  id: string;
  pod_name: string;
  pod_ip: string;
  direct_port: number;
  created_at: Timestamp;
  last_activity: Timestamp;
  status: "inactive" | "starting" | "running" | "stopping";
  owner_user_id: string;
  name: string;
}
```

---

## ApiKeyService

Accepts Clerk JWT **only**.

### CreateApiKey
```
POST /api.v1.ApiKeyService/CreateApiKey

Request:  { "name": string }
Response: { "key": ApiKey, "secret": string }
```
The `secret` is returned **once only** and never stored in plaintext.

### ListApiKeys
```
POST /api.v1.ApiKeyService/ListApiKeys

Request:  {}
Response: { "keys": ApiKey[] }
```

### DeleteApiKey
```
POST /api.v1.ApiKeyService/DeleteApiKey

Request:  { "id": string }
Response: {}
```

### ApiKey Object

```typescript
interface ApiKey {
  id: string;
  name: string;
  prefix: string;         // e.g., "bstr_AbC1"
  created_at: Timestamp;
  last_used_at: Timestamp | null;
}
```

---

## StreamService

Accepts Clerk JWT **only**.

### CreateStreamDestination
```
POST /api.v1.StreamService/CreateStreamDestination

Request:
{
  "name": string,
  "platform": string,    // "twitch" | "youtube" | "kick" | "restream" | "custom"
  "rtmp_url": string,
  "stream_key": string,  // stored AES-256-GCM encrypted
  "enabled": boolean
}
Response: { "destination": StreamDestination }
```

### ListStreamDestinations
```
POST /api.v1.StreamService/ListStreamDestinations

Request:  { "stage_id": string }
Response: { "destinations": StreamDestination[] }
```

### UpdateStreamDestination
```
POST /api.v1.StreamService/UpdateStreamDestination

Request:
{
  "id": string,
  "name": string,
  "platform": string,
  "rtmp_url": string,
  "stream_key": string,
  "enabled": boolean
}
Response: { "destination": StreamDestination }
```

### DeleteStreamDestination
```
POST /api.v1.StreamService/DeleteStreamDestination

Request:  { "id": string }
Response: {}
```

### StreamDestination Object

```typescript
interface StreamDestination {
  id: string;
  name: string;
  platform: string;
  rtmp_url: string;
  stream_key: string;    // decrypted on read
  enabled: boolean;
  created_at: Timestamp;
  updated_at: Timestamp;
}
```

---

## UserService

Accepts Clerk JWT **only**.

### GetProfile
```
POST /api.v1.UserService/GetProfile

Request:  {}
Response:
{
  "user_id": string,
  "email": string,
  "name": string,
  "stage_count": number,
  "api_key_count": number
}
```

---

## Non-RPC HTTP Endpoints (Control Plane)

### Health
```
GET /health
Response: { "status": "ok" }
         or (if authenticated): { "status": "ok", "stages": N, "maxStages": N }
```

### CDP Proxy
```
GET  /stage/<stage-id>/cdp                Chrome version info (webSocketDebuggerUrl rewritten)
GET  /stage/<stage-id>/cdp/json/version   Chrome version info (webSocketDebuggerUrl rewritten)
GET  /stage/<stage-id>/cdp/json           Tab list (WS URLs rewritten)
WS   /stage/<stage-id>/cdp               Full CDP WebSocket proxy to Chrome
```
Auth: Clerk JWT or API key. The `webSocketDebuggerUrl` is rewritten to `wss://<host>/stage/<stage-id>/cdp`.

### Stage Proxy
```
*    /stage/<id>/<path>     HTTP proxy to streamer pod (auth required)
WS   /stage/<id>/*          WebSocket proxy to streamer pod
POST /stage/<id>/mcp/*      MCP server for this stage
```

---

## Streamer Pod API (via stage proxy at `/stage/<id>/...`)

### Panel Management
```
POST   /api/panels                     Create panel ({ name, width?, height? })
GET    /api/panels/:name/script        Get user code
POST   /api/panels/:name/script        Set script ({ script: string })
PATCH  /api/panels/:name/script        Edit script ({ old_string, new_string })
POST   /api/panels/:name/event         Emit state event ({ event, data })
GET    /api/panels/:name/screenshot    Capture PNG screenshot
```

### CDP Discovery
```
GET /json           Chrome tab list
GET /json/version   Chrome version
GET /json/list      Available tabs
```

### Health
```
GET /health     { status: 'ok', lastActivity, uptime }
```

**Methods:**
1. **Clerk JWT** — `Authorization: Bearer <clerk-jwt-token>`
2. **API Key** — `Authorization: Bearer bstr_<64-char-hex>`
3. **Query Parameter** — `?token=<token>` (fallback)

**Service-Level Restrictions:**
- SessionService: Accepts both Clerk JWT and API key
- ApiKeyService, StreamService, UserService, EndpointService: Clerk JWT only
- MCP endpoints: Accepts both Clerk JWT and API key
- HTTP proxy/CDP endpoints: Accepts both

---

## ConnectRPC Services

All ConnectRPC services use POST method with path `/api.v1.<ServiceName>/<Method>`. Support Connect, gRPC, and gRPC-Web protocols with Protobuf and JSON codecs.

### SessionService

#### CreateSession
```
POST /api.v1.SessionService/CreateSession
Request: {} (empty)
Response: {
  session: {
    id: string,           // UUID
    pod_name: string,     // k8s pod name
    pod_ip: string,       // Pod cluster IP (empty until running)
    direct_port: int32,
    created_at: Timestamp,
    last_activity: Timestamp,
    status: string,       // "starting" | "running" | "stopping"
    owner_user_id: string
  }
}
Errors: ResourceExhausted (max sessions), Internal (pod creation failure)
```

#### ListSessions
```
POST /api.v1.SessionService/ListSessions
Request: {} (empty)
Response: { sessions: Session[] }  // Only sessions owned by authenticated user
```

#### GetSession
```
POST /api.v1.SessionService/GetSession
Request: { id: string }
Response: { session: Session }
Errors: NotFound
```

#### DeleteSession
```
POST /api.v1.SessionService/DeleteSession
Request: { id: string }
Response: {} (empty)
Errors: NotFound
```

### ApiKeyService (Clerk JWT only)

#### CreateApiKey
```
POST /api.v1.ApiKeyService/CreateApiKey
Request: { name: string }
Response: {
  key: {
    id: string,
    name: string,
    prefix: string,       // First 13 chars + "..."
    created_at: Timestamp,
    last_used_at: Timestamp (nullable)
  },
  secret: string          // Full key (bstr_<hex>), shown only once
}
```

#### ListApiKeys
```
POST /api.v1.ApiKeyService/ListApiKeys
Request: {} (empty)
Response: { keys: ApiKey[] }
```

#### DeleteApiKey
```
POST /api.v1.ApiKeyService/DeleteApiKey
Request: { id: string }
Response: {} (empty)
```

### StreamService (Clerk JWT only)

#### CreateStreamDestination
```
POST /api.v1.StreamService/CreateStreamDestination
Request: {
  name: string,
  platform: string,       // "twitch" | "youtube" | "kick" | "restream" | "custom"
  rtmp_url: string,
  stream_key: string,     // Encrypted with AES-256-GCM before storage
  enabled: bool
}
Response: { destination: StreamDestination }  // stream_key returned unencrypted
```

#### ListStreamDestinations
```
POST /api.v1.StreamService/ListStreamDestinations
Request: { session_id: string }
Response: { destinations: StreamDestination[] }  // stream_key masked (first 4 chars + ***)
```

#### UpdateStreamDestination
```
POST /api.v1.StreamService/UpdateStreamDestination
Request: { id, name, platform, rtmp_url, stream_key, enabled }
Response: { destination: StreamDestination }
```

#### DeleteStreamDestination
```
POST /api.v1.StreamService/DeleteStreamDestination
Request: { id: string }
Response: {} (empty)
```

### UserService (Clerk JWT only)

#### GetProfile
```
POST /api.v1.UserService/GetProfile
Request: {} (empty)
Response: {
  user_id: string,
  email: string,
  name: string,
  session_count: int32,
  api_key_count: int32
}
```

### EndpointService (Clerk JWT only)

#### CreateEndpoint
```
POST /api.v1.EndpointService/CreateEndpoint
Request: { name: string }
Response: { endpoint: { id: string, name: string, created_at: Timestamp } }
```

#### ListEndpoints
```
POST /api.v1.EndpointService/ListEndpoints
Request: {} (empty)
Response: { endpoints: Endpoint[] }
```

#### DeleteEndpoint
```
POST /api.v1.EndpointService/DeleteEndpoint
Request: { id: string }
Response: {} (empty)
```

---

## HTTP Endpoints

### Health Check
```
GET /health
Auth: Optional
Response: { status: "ok" }
Response (authenticated): { status: "ok", sessions: int, maxSessions: int }
```

### CDP Auto-Provisioning
```
GET /stage/<uuid>/cdp
GET /stage/<uuid>/cdp/json/version
GET /stage/<uuid>/cdp/json
WS  /stage/<uuid>/cdp
Auth: Required
Behavior: Returns 503 if stage is not active (call start first)
HTTP: Returns Chrome CDP discovery JSON with rewritten WebSocket URLs
WS: Proxies directly to Chrome port 9222
```

### Session Proxy
```
ANY /session/:id/*
WS  /session/:id/*
Auth: Required
Behavior: Reverse proxy to pod at http://<podIP>:8080
Path rewriting: Strips /session/:id prefix
Errors: 404 (session not found), 503 (session not ready)
```

---

## MCP Server

### Endpoint
```
/mcp/<agent-uuid>/
Protocol: StreamableHTTP
Auth: Required (Clerk JWT or API key)
```

### Tools

| Tool | Args | Returns |
|------|------|---------|
| `start` | (none) | `{"status": "running"}` or `{"status": "already_running"}` |
| `stop` | (none) | `{"status": "stopped"}` or `{"status": "already_stopped"}` |
| `status` | (none) | `{"status": "running\|stopped\|starting"}` |
| `set_script` | `script: string` | Pod response JSON |
| `get_script` | (none) | `{"script": "..."}` |
| `edit_script` | `old_string: string, new_string: string` | Updated script JSON |
| `emit_event` | `event: string, data: JSON` | Pod response JSON |
| `screenshot` | (none) | Base64 PNG image content |
| `gobs` | `args: string[]` | OBS command output (redacted) |

---

## Streamer Pod API (Internal)

Accessed via session proxy (`/session/:id/...`) or directly by session manager.

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | None | Health/readiness check |
| GET | `/json`, `/json/version`, `/json/list` | Token | CDP discovery |
| POST | `/api/panel/main` | Token | Set script (`{ script }`) |
| GET | `/api/panel/main` | Token | Get current script |
| POST | `/api/panel/main/edit` | Token | Edit script (`{ old_string, new_string }`) |
| POST | `/api/panel/main/event` | Token | Emit event (`{ event, data }`) |
| GET | `/template` | None | Serve HTML to Chrome |
| POST | `/api/navigate` | Token | Navigate Chrome (`{ url }`) |
| WS | `/*` | Token | CDP WebSocket proxy |
