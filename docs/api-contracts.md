# API Contracts

## Authentication

All endpoints (except `GET /health` and dashboard static files) require authentication.

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
GET /cdp/<uuid>
GET /cdp/<uuid>/json/version
GET /cdp/<uuid>/json
WS  /cdp/<uuid>
Auth: Required
Behavior: Auto-creates session if not exists, waits up to 60s for readiness
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
