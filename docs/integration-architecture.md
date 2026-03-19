# Integration Architecture

**Last updated:** 2026-03-09

## Overview

Agent Streamer (Dazzle) is a monorepo with 7 parts. The **control plane** is the central hub: it orchestrates Kubernetes pods, proxies all traffic, and serves the web SPA. The **ingest** server receives RTMP streams from external sources. The two primary consumers are the **Dazzle CLI** (`dazzle`) and the **Web UI** — both communicate with the control plane via ConnectRPC. HTTP traffic enters through Traefik; RTMP traffic enters via a Traefik TCP entrypoint on port 1935.

---

## Part Communication Map

```
┌──────────────────────────────────────────────────────────────┐
│                    Primary Consumers                         │
│   CLI (dazzle) ─── ConnectRPC ──┐                            │
│   Web UI ──────── ConnectRPC ───┘                            │
└─────────────────────┬────────────────────────────────────────┘
                      │ HTTPS (dazzle.fm)
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
│  Init: sidecar restore (R2 → /data/)        │
│                                              │
│  Main container:                             │
│  ┌────────────┐  ┌──────────┐               │
│  │  Chrome    │  │  Xvfb    │               │
│  │  CDP :9222 │  │  :99     │               │
│  └────────────┘  └──────────┘               │
│                                              │
│  Sidecar: Go binary :8080                   │
│    Content sync, CDP, ffmpeg pipeline, R2   │
└──────────────────────────────────────────────┘

┌──────────────────────────────────────────────┐
│        RTMP Ingest (nginx-rtmp)              │
│                                              │
│  :1935 ← OBS/Streamlabs/ffmpeg              │
│    on_publish → control-plane:9090 (auth)    │
│    H.264/AAC → HLS transmux (codec copy)    │
│  :8080 → HLS segments served to CP proxy    │
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
| ConnectRPC | `/stage/<id>/_dz_9f7a3b1c/*` | `http://<podIP>:8080/_dz_9f7a3b1c/*` | Sidecar RPC proxy (sync, runtime, broadcast) |
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
| Init restore | R2 → `/data/` | `/sidecar restore` runs at init to pull content from R2 before main container starts |
| Live sync | `/data/` → R2 | Sidecar uses fsnotify file watcher with debounced upload via minio-go SDK |
| Final sync | `/data/` → R2 | On SIGTERM, sidecar performs FinalSync before exiting (no sentinel file protocol) |
| Cleanup | control-plane → R2 | On `DeleteStage`, control plane calls `R2Client.DeletePrefix()` after pod termination |

**Paths synced:** `content/**`, `chrome/Default/Local Storage/**`, `chrome/Default/IndexedDB/**`
**R2 layout:** `users/<user_id>/stages/<stage_id>/`
**Auth:** S3-compatible credentials via `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` env vars injected from `r2-credentials` secret.

### 6. RTMP Ingest (nginx-rtmp)

External RTMP sources (OBS, Streamlabs, ffmpeg) push to the ingest server using a stage's stream key.

| Direction | Protocol | Port | Description |
|-----------|----------|------|-------------|
| OBS → Ingest | RTMP | 1935 | `rtmp://ingest.dazzle.fm/live/<stream_key>` via Traefik TCP entrypoint |
| Ingest → Control Plane | HTTP POST | 9090 | `on_publish` / `on_publish_done` callbacks for stream key validation |
| Control Plane → Ingest | HTTP GET | 8080 | HLS proxy fetches segments for `/watch/{stageId}` viewer page |

**Auth:** The `on_publish` callback looks up the stage by `stream_key` in the `stages` table. Invalid keys return HTTP 403 (nginx-rtmp drops the publisher).

**HLS transmux:** nginx-rtmp copies H.264/AAC directly to HLS segments (no re-encoding). Segments stored at `/tmp/hls/<stream_key>/` on the ingest pod.

**Internal port:** RTMP callbacks run on control-plane port 9090 (not the public 8080), so they're only reachable from within the cluster.

### 7. Public Watch Page

When a stage is broadcasting, its HLS stream is publicly viewable at `/watch/{slug}` without authentication. The slug is a short 12-character hex ID derived from the stage's UUIDv7 (e.g., `/watch/a1b2c3d4e5f6`).

| Protocol | Path | Source | Description |
|----------|------|--------|-------------|
| HTTP | `/watch/{slug}/hls/stream.m3u8` | Control plane | HLS proxy to sidecar (no auth, CORS enabled) |
| HTTP | `/watch/{slug}/hls/*.ts` | Control plane | HLS segment proxy |
| HTTP | `/watch/{slug}` | Control plane | SPA watch page (HLS.js player) |

The control plane resolves the slug to a stage ID via DB lookup, then proxies HLS from the sidecar (same as the authenticated preview proxy, but without requiring a preview token or Clerk JWT).

### 8. MCP Client → Control Plane *(legacy, being superseded by CLI)*

| Protocol | Path | Description |
|----------|------|-------------|
| HTTP (StreamableHTTP) | `/stage/<stage-id>/mcp/*` | MCP tool invocation for this stage |

> **Note:** MCP is being superseded by the Dazzle CLI. All operations available via MCP are now accessible through `dazzle` CLI commands using ConnectRPC. The MCP endpoint remains functional but is no longer the recommended integration path.

### 7. Control Plane → Streamer Pod (Sidecar RPC)

The control plane proxies CLI/MCP operations to the sidecar's ConnectRPC services on port 8080, all behind the `/_dz_9f7a3b1c/` path prefix:

| Operation | ConnectRPC Service | Description |
|-----------|-------------------|-------------|
| Sync diff/push/refresh | `SyncService` | Diff, push content (auto-refreshes browser on sync) |
| Emit event | `RuntimeService.EmitEvent` | Push event to Chrome via CDP |
| Screenshot | `RuntimeService.Screenshot` | Capture PNG via CDP |
| Broadcast control | `ObsService.Command` | Streaming control (start/stop broadcast, configure RTMP destination) |

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
   - CLI (dazzle)    → ConnectRPC: stage lifecycle, sync, screenshots, broadcast, destinations
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
| `/data` emptyDir volume | streamer + sidecar | Shared content and Chrome state |
| `hls-data` emptyDir volume | streamer + sidecar | HLS preview segments |
