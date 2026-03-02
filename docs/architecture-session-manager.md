# Architecture: Session Manager (Go Control Plane)

## Overview

The session manager is the central control plane for the Dazzle platform. It orchestrates ephemeral browser pods on Kubernetes, handles authentication, serves the dashboard SPA, exposes ConnectRPC APIs, provides an MCP server for AI agent integration, and reverse-proxies traffic to running sessions.

## Technology Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Language | Go | 1.24 |
| RPC Framework | ConnectRPC | v1.19.1 |
| Auth | Clerk SDK | v2.5.1 |
| Database | PostgreSQL (lib/pq) | v1.11.2 |
| Kubernetes | client-go | v0.29.3 |
| MCP | mcp-go | v0.44.1 |
| WebSocket | gorilla/websocket | v1.5.3 |
| Protobuf | google.golang.org/protobuf | v1.36.9 |

## Source Files

| File | LOC | Purpose |
|------|-----|---------|
| `main.go` | ~900 | HTTP server, routing, pod lifecycle, proxy handlers, session management |
| `auth.go` | ~190 | Clerk JWT verification, API key validation, JWK caching |
| `db.go` | ~300 | Database schema migrations, CRUD operations, encryption |
| `mcp.go` | ~750 | MCP server with 8 tools (start, stop, status, set_html, get_html, edit_html, screenshot, gobs) |
| `connect_session.go` | ~80 | ConnectRPC SessionService handlers |
| `connect_apikey.go` | ~65 | ConnectRPC ApiKeyService handlers |
| `connect_stream.go` | ~110 | ConnectRPC StreamService handlers |
| `connect_user.go` | ~25 | ConnectRPC UserService handlers |
| `gen/` | (generated) | Protobuf-generated Go code |
| `proto/` | - | Protobuf service definitions |
| `migrations/` | - | SQL migration files |

## API Surface

### ConnectRPC Services (Protobuf)

Path prefix: `/api.v1.<ServiceName>/`

**SessionService** (Clerk JWT or API key auth):
- `CreateSession` — Creates streamer pod, returns session details
- `ListSessions` — Lists sessions for authenticated user
- `GetSession` — Gets specific session by ID
- `DeleteSession` — Kills session pod and marks stopped

**ApiKeyService** (Clerk JWT only):
- `CreateApiKey` — Generates `bstr_*` key, returns secret once
- `ListApiKeys` — Lists keys with prefix display
- `DeleteApiKey` — Revokes key

**StreamService** (Clerk JWT only):
- `CreateStreamDestination` — Stores RTMP destination with AES-256-GCM encrypted stream key
- `ListStreamDestinations` — Returns destinations with masked stream keys
- `UpdateStreamDestination` — Updates destination details
- `DeleteStreamDestination` — Removes destination

**UserService** (Clerk JWT only):
- `GetProfile` — Returns user profile with session and API key counts

### HTTP Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | Optional | Health check, returns session count if authed |
| GET/WS | `/cdp/<uuid>` | Required | CDP auto-provisioning + WebSocket proxy |
| ANY | `/session/:id/*` | Required | HTTP/WS reverse proxy to pod |
| GET | `/mcp/<uuid>/*` | Required | MCP StreamableHTTP server |
| GET | `/*` | None | Dashboard SPA (static files) |

### MCP Tools

Exposed at `/mcp/<agent-uuid>/` via StreamableHTTP:

| Tool | Args | Purpose |
|------|------|---------|
| `start` | none | Create and start session, configure OBS with stream destination |
| `stop` | none | Destroy session pod |
| `status` | none | Get session state (running/stopped/starting) |
| `set_html` | `html` | Render HTML in Chrome |
| `get_html` | none | Get current HTML content |
| `edit_html` | `old_string`, `new_string` | Find-and-replace in current HTML |
| `screenshot` | none | Capture OBS output as PNG (via WebSocket v5) |
| `gobs` | `args[]` | Execute OBS commands (with blocked commands for security) |

## Authentication Architecture

**Dual Auth System:**

1. **Clerk JWT** — For dashboard users (email/password, social login)
   - JWT validation with JWK caching (in-memory, single key)
   - Cache-miss retry on verification failure (handles key rotation)
   - User upserted to `users` table on first auth

2. **API Key** — For server-to-server / agent access
   - Format: `bstr_<64-char-hex>` (80 chars total)
   - Storage: SHA256 hash in `api_keys.key_hash`
   - `last_used_at` updated asynchronously (background goroutine)

**Authorization Layers:**
- General auth interceptor (accepts both methods)
- Clerk-only interceptor (rejects API keys — applied to ApiKey, Stream, User services)
- User isolation: all queries filter by `user_id`

## Kubernetes Pod Management

**Pod Lifecycle:**
1. **Create** — `streamer-<uuid[:8]>`, labels: `app=streamer-session`, `session-id=<uuid>`, `managed-by=session-manager`
2. **Wait** — Polls pod status every 500ms until Running + PodIP populated (60s timeout)
3. **Proxy** — Routes traffic via reverse proxy or CDP WebSocket tunnel
4. **Delete** — Removes pod via k8s API, logs to `session_log` table

**Resource Allocation per Pod:**
- Requests: 2 CPU, 4Gi RAM
- Limits: 4 CPU, 8Gi RAM
- `/dev/shm`: 2Gi EmptyDir (Memory medium)

**Background Loops (5s interval):**
- **Status Refresh** — Syncs pod state from k8s API
- **Garbage Collection** — Kills pods stuck in Starting > 3 minutes

**Recovery on Startup:**
- Lists all `app=streamer-session` pods
- Rebuilds in-memory session map
- Recovers owner/port from `session_log` table

## Database Schema

**PostgreSQL** (configured via DB_HOST/PORT/USER/PASSWORD/NAME env vars)

### Tables

**users**: `id` (Clerk ID, PK), `email`, `name`, `created_at`, `updated_at`

**api_keys**: `id` (UUID, PK), `user_id` (FK→users), `name`, `prefix`, `key_hash` (SHA256), `created_at`, `last_used_at`

**stream_destinations**: `id` (UUID, PK), `user_id` (FK→users), `name`, `platform`, `rtmp_url`, `stream_key` (AES-256-GCM encrypted), `enabled`, `created_at`, `updated_at`

**session_log**: `id` (session UUID, PK), `user_id` (FK→users), `pod_name`, `direct_port`, `created_at`, `ended_at`, `end_reason`

## Proxy Architecture

**HTTP Reverse Proxy:** `httputil.NewSingleHostReverseProxy` → strips `/session/:id` prefix → forwards to `http://<podIP>:8080`

**WebSocket Proxy:** Manual TCP hijack → bidirectional `io.Copy()` goroutines → forwards to Chrome port 9222

**CDP Discovery Rewrite:** Fetches Chrome's `/json/version`, rewrites `webSocketDebuggerUrl` to deterministic external URL (`ws[s]://<host>/cdp/<uuid>`)

## Security

- **Encryption:** AES-256-GCM for stream keys at rest
- **CORS:** Permissive (`*` origin, standard methods/headers)
- **MCP Security:** Blocked OBS commands (`stream-service`, `set ss`) prevent credential exposure; RTMP URLs redacted from output
- **Graceful Shutdown:** Signal handler (SIGINT/SIGTERM), DB close, HTTP server shutdown
