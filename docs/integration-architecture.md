# Integration Architecture

**Last updated:** 2026-03-03

## Overview

Browser Streamer (Dazzle) is a monorepo with 4 parts. The **control plane** is the central hub: it orchestrates Kubernetes pods, proxies all traffic, and serves the web SPA. All external traffic enters through Traefik and flows to the control plane.

---

## Part Communication Map

```
┌──────────────────────────────────────────────────────────────┐
│                      External Clients                         │
│   (Browser, AI Agents, Claude Code MCP, CDP tools)           │
└─────────────────────┬────────────────────────────────────────┘
                      │ HTTPS (stream.dazzle.fm)
                      ▼
┌──────────────────────────────────────────────────────────────┐
│               Traefik Ingress (TLS termination)               │
└─────────────────────┬────────────────────────────────────────┘
                      │ HTTP :8080
                      ▼
┌──────────────────────────────────────────────────────────────┐
│                   Control Plane (Go)                          │
│                                                               │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐    │
│  │  Web SPA │  │ConnectRPC│  │   MCP    │  │CDP/Stage │    │
│  │ (GET /)  │  │  /api.v1 │  │ /stage/* │  │  Proxy   │    │
│  └──────────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘    │
│                     │             │              │            │
│  ┌──────────────────┴─────────────┴──────────────┘           │
│  │              Pod Lifecycle Manager                         │
│  │  (create/delete/watch k8s pods)                           │
│  │               + PostgreSQL                                 │
│  └──────────┬──────────────────────┬──────────────────────┐  │
│             │                      │                      │  │
│  ┌──────────▼──────┐   ┌───────────▼──────┐  ┌───────────▼┐ │
│  │ HTTP Proxy      │   │  WS Proxy        │  │ PostgreSQL │ │
│  │ /stage/<id>/*   │   │  /cdp/<id>       │  │ (users,    │ │
│  └──────────┬──────┘   └──────────┬───────┘  │  api_keys, │ │
└─────────────┼─────────────────────┼──────────│  stages,   ├─┘
              │                     │          │  streams)  │
              ▼                     ▼          └────────────┘
┌──────────────────────────────────────────────┐
│           Streamer Pod (per stage)            │
│                                               │
│  ┌────────────┐  ┌──────────┐  ┌──────────┐  │
│  │  Chrome    │  │  OBS     │  │ Node.js  │  │
│  │  CDP :9222 │  │  WS:4455 │  │ :8080    │  │
│  └────────────┘  └──────────┘  └──────────┘  │
│  ┌────────────┐  ┌──────────┐                 │
│  │  Xvfb :99  │  │ Vite HMR │                 │
│  └────────────┘  └──────────┘                 │
└──────────────────────────────────────────────┘
```

---

## Integration Points

### 1. Web Frontend → Control Plane (ConnectRPC)

| Protocol | Path | Description |
|----------|------|-------------|
| ConnectRPC | `/api.v1.StageService/*` | Stage CRUD |
| ConnectRPC | `/api.v1.ApiKeyService/*` | API key CRUD |
| ConnectRPC | `/api.v1.StreamService/*` | Stream destination CRUD |
| ConnectRPC | `/api.v1.UserService/*` | User profile |

**Auth:** Clerk JWT injected as `Authorization: Bearer` via connect-web interceptor.

In development, Vite proxies these paths from `:5173` to `:8080`.

### 2. Control Plane → Kubernetes API

| Action | k8s API | Description |
|--------|---------|-------------|
| Create Pod | `POST /api/v1/namespaces/{ns}/pods` | Launch streamer pod |
| Delete Pod | `DELETE /api/v1/namespaces/{ns}/pods/{name}` | Terminate stage |
| List Pods | `GET /api/v1/namespaces/{ns}/pods?labelSelector=app=streamer-stage` | Status refresh (every 5s) |

**Auth:** In-cluster ServiceAccount with RBAC on `pods` resource (get, list, watch, create, delete).

### 3. Control Plane → Streamer Pod (Proxy)

| Protocol | Path Pattern | Destination | Description |
|----------|-------------|-------------|-------------|
| HTTP | `/stage/<id>/<path>` | `http://<podIP>:8080/<path>` | General API proxy (panel system) |
| WebSocket | `/stage/<id>/*` | `ws://<podIP>:8080/*` | WebSocket proxy |
| WebSocket | `/cdp/<id>` | `ws://<podIP>:8080/devtools/...` | CDP WebSocket (URL resolved via `/json/version`) |
| HTTP | `/cdp/<id>/json/*` | `http://<podIP>:8080/json/*` | CDP discovery (WS URL rewritten) |
| HTTP | `/stage/<id>/mcp/*` | MCP server in control plane | MCP tool execution targeting this stage |

**Auth:** Internal `POD_TOKEN` passed as query parameter to streamer for pod-level requests.

### 4. Control Plane → PostgreSQL

| Operation | Tables | Description |
|-----------|--------|-------------|
| User upsert | `users` | On first Clerk JWT auth |
| Stage CRUD | `stages` | Create/update/delete stage records |
| API key CRUD | `api_keys` | Key management + `last_used_at` updates |
| Stream dest CRUD | `stream_destinations` | RTMP destination config |
| Schema migrations | `schema_migrations` | Version tracking |

**Connection:** `postgres://browser_streamer:<password>@postgres:5432/browser_streamer` (configurable via env)

### 5. MCP Client → Control Plane (MCP Protocol)

| Protocol | Path | Description |
|----------|------|-------------|
| HTTP (StreamableHTTP) | `/stage/<stage-id>/mcp/*` | MCP tool invocation for this stage |

**Auth:** Clerk JWT or API key. Stage ID in path routes tools to the correct pod.

MCP tools available: `start`, `stop`, `set_script`, `edit_script`, `get_script`, `emit_event`, `screenshot`, OBS controls via `gobs`.

### 6. Control Plane MCP → Streamer Pod

MCP tool implementations in `mcp.go` call the streamer pod's panel API:

| MCP Tool | Streamer Endpoint | Description |
|----------|-------------------|-------------|
| `set_script` | `POST /api/panels/:name/script` | Set panel JavaScript content |
| `edit_script` | `PATCH /api/panels/:name/script` | Find-replace in panel script |
| `get_script` | `GET /api/panels/:name/script` | Retrieve current panel code |
| `emit_event` | `POST /api/panels/:name/event` | Push state event to panel |
| `screenshot` | `GET /api/panels/:name/screenshot` | Capture PNG via CDP |
| `gobs` | `gobs-cli --host <podIP>` | OBS commands via CLI |

---

## Stage Lifecycle Data Flow

```
1. User authenticates (Clerk JWT or API key)
2. User calls CreateStage (ConnectRPC) → DB record created (status: inactive)
3. User calls GetStage (ConnectRPC) → control plane activates stage:
   a. Creates k8s Pod (streamer image, labels: app=streamer-stage, stage-id=<id>)
   b. Polls pod status every 500ms until Running + PodIP set
   c. Returns stage with status=running and pod_ip
4. Client interacts via:
   - ConnectRPC API  → stage management
   - /stage/<id>/*   → HTTP/WS proxy to streamer panel API
   - /cdp/<id>       → Chrome DevTools Protocol
   - /stage/<id>/mcp → MCP server (AI agents)
5. Background GC loop (5s):
   - Refreshes pod statuses from k8s
   - Deletes stages stuck in "starting" >3 minutes
6. User calls DeleteStage → pod deleted, DB record removed
   OR DeactivateStage  → pod deleted, DB record stays (status: inactive)
```

---

## Shared Dependencies

| Dependency | Used By | Purpose |
|------------|---------|---------|
| Protobuf schemas (`proto/api/v1/`) | control-plane + web | Service contracts (generated code) |
| `browserless-auth` k8s secret | control-plane + streamer pods | Internal pod auth token |
| `ENCRYPTION_KEY` env | control-plane | AES-256-GCM for stream key encryption |
| PostgreSQL | control-plane | Persistent storage |
| Clerk | control-plane + web | User authentication |
| k8s namespace `browser-streamer` | All | Resource isolation |
| Traefik ingress | All external traffic | TLS + routing |
