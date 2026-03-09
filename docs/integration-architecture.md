# Integration Architecture

**Last updated:** 2026-03-03

## Overview

Agent Streamer (Dazzle) is a monorepo with 5 parts. The **control plane** is the central hub: it orchestrates Kubernetes pods, proxies all traffic, and serves the web SPA. The two primary consumers are the **Dazzle CLI** (`dazzle`) and the **Web UI** — both communicate with the control plane via ConnectRPC. All external traffic enters through Traefik and flows to the control plane.

---

## Part Communication Map

```
┌──────────────────────────────────────────────────────────────┐
│                    Primary Consumers                         │
│   CLI (dazzle) ─── ConnectRPC ──┐                            │
│   Web UI ──────── ConnectRPC ───┘                            │
└─────────────────────┬────────────────────────────────────────┘
                      │ HTTPS (stream.dazzle.fm)
                      ▼
┌──────────────────────────────────────────────────────────────┐
│               Traefik Ingress (TLS termination)              │
└─────────────────────┬────────────────────────────────────────┘
                      │ HTTP :8080
                      ▼
┌──────────────────────────────────────────────────────────────┐
│                   Control Plane (Go)                         │
│                                                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐               │
│  │  Web SPA │  │ConnectRPC│  │CDP/Stage │               │
│  │ (GET /)  │  │  /api.v1 │  │  Proxy   │               │
│  └──────────┘  └────┬─────┘  └────┬─────┘               │
│                     │             │              │           │
│  ┌──────────────────┴─────────────┴──────────────┘           │
│  │              Pod Lifecycle Manager                        │
│  │  (create/delete/watch k8s pods)                           │
│  │               + PostgreSQL                                │
│  └──────────┬──────────────────────┬──────────────────────┐  │
│             │                      │                      │  │
│  ┌──────────▼──────┐   ┌───────────▼──────┐  ┌───────────▼┐ │
│  │ HTTP Proxy      │   │  WS Proxy        │  │ PostgreSQL │ │
│  │ /stage/<id>/*   │   │  /stage/<id>/cdp │  │ (users,    │ │
│  └──────────┬──────┘   └──────────┬───────┘  │  api_keys, │ │
└─────────────┼─────────────────────┼──────────│  stages,   ├──┘
              │                     │          │  streams)  │
              ▼                     ▼          └────────────┘
┌──────────────────────────────────────────────┐
│           Streamer Pod (per stage)           │
│                                              │
│  Init: restore.sh (R2 → /data/)             │
│                                              │
│  Main container:                             │
│  ┌────────────┐  ┌──────────┐  ┌──────────┐ │
│  │  Chrome    │  │  OBS     │  │ Node.js  │ │
│  │  CDP :9222 │  │  WS:4455 │  │ :8080    │ │
│  └────────────┘  └──────────┘  └──────────┘ │
│  ┌────────────┐  ┌──────────┐  ┌──────────┐ │
│  │  Xvfb :99  │  │          │  │  ffmpeg  │ │
│  └────────────┘  └──────────┘  │ HLS prev │ │
│                                 └──────────┘ │
│  Sidecar: rclone (/data/ ↔ R2)              │
└──────────────────────────────────────────────┘
```

---

## Integration Points

### 1. CLI / Web Frontend → Control Plane (ConnectRPC)

The CLI and Web UI are the primary consumers of the ConnectRPC API. The CLI authenticates with API keys (`dzl_*`); the Web UI uses Clerk JWT.

| Protocol | Path | Description |
|----------|------|-------------|
| ConnectRPC | `/api.v1.StageService/*` | Stage CRUD |
| ConnectRPC | `/api.v1.ApiKeyService/*` | API key CRUD |
| ConnectRPC | `/api.v1.RtmpDestinationService/*` | Stream destination CRUD |
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
| WebSocket | `/stage/<id>/cdp` | `ws://<podIP>:8080/devtools/...` | CDP WebSocket (URL resolved via `/json/version`) |
| HTTP | `/stage/<id>/cdp/json/*` | `http://<podIP>:8080/json/*` | CDP discovery (WS URL rewritten) |
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

### 5. Sidecar ↔ Cloudflare R2

| Action | Direction | Description |
|--------|-----------|-------------|
| Init restore | R2 → `/data/` | `restore.sh` runs `rclone sync` from R2 before main container starts |
| Live sync | `/data/` → R2 | Sidecar watches with `inotifywait`, syncs on changes (debounced, flock-guarded) |
| Final sync | `/data/` → R2 | Triggered by prestop hook via `.sync-request` sentinel; sidecar acks with `.sync-done` |
| Cleanup | control-plane → R2 | On `DeleteStage`, control plane calls `R2Client.DeletePrefix()` after pod termination |

**Paths synced:** `content/**`, `chrome/Default/Local Storage/**`, `chrome/Default/IndexedDB/**`
**R2 layout:** `users/<user_id>/stages/<stage_id>/`
**Auth:** rclone uses S3-compatible credentials via `RCLONE_CONFIG_R2_*` env vars injected from `r2-credentials` secret.

### 6. MCP Client → Control Plane *(legacy, being superseded by CLI)*

| Protocol | Path | Description |
|----------|------|-------------|
| HTTP (StreamableHTTP) | `/stage/<stage-id>/mcp/*` | MCP tool invocation for this stage |

> **Note:** MCP is being superseded by the Dazzle CLI. All operations available via MCP are now accessible through `dazzle` CLI commands using ConnectRPC. The MCP endpoint remains functional but is no longer the recommended integration path.

### 7. Control Plane → Streamer Pod (Panel API)

The control plane proxies CLI/MCP operations to the streamer pod's panel API:

| Operation | Streamer Endpoint | Description |
|-----------|-------------------|-------------|
| Sync | `POST /api/panels/:name/sync` | Push synced files to panel |
| Emit event | `POST /api/panels/:name/event` | Push state event to panel |
| Screenshot | `GET /api/panels/:name/screenshot` | Capture PNG via CDP |
| OBS | `gobs-cli --host <podIP>` | OBS commands (scenes, streaming, recording, etc.) |

---

## Stage Lifecycle Data Flow

```
1. User authenticates (CLI uses API key, Web UI uses Clerk JWT)
2. User calls CreateStage (ConnectRPC — via CLI or Web UI) → DB record created (status: inactive)
3. User calls GetStage/ActivateStage (ConnectRPC) → control plane activates stage:
   a. Creates k8s Pod (streamer image, labels: app=streamer-stage, stage-id=<id>)
   b. Polls pod status every 500ms until Running + PodIP set
   c. Returns stage with status=running and pod_ip
4. Client interacts via:
   - CLI (dazzle)    → ConnectRPC: stage lifecycle, script, screenshots, OBS, destinations
   - Web UI          → ConnectRPC: stage monitoring, API keys, destinations
   - /stage/<id>/cdp → Chrome DevTools Protocol (programmatic access)
   - /stage/<id>/*   → HTTP/WS proxy to streamer panel API
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
| PostgreSQL | control-plane | Persistent storage (users, stages, keys, destinations) |
| Cloudflare R2 | control-plane + sidecar | Stage content and Chrome state persistence |
| Clerk | control-plane + web | User authentication |
| k8s namespace `browser-streamer` | All | Resource isolation |
| Traefik ingress | All external traffic | TLS + routing |
| `/data` emptyDir volume | streamer + sidecar + init | Shared content and Chrome state |
