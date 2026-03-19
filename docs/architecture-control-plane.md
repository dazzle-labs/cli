# Architecture: Control Plane

**Part:** `control-plane/`
**Language:** Go 1.25
**Last updated:** 2026-03-09

> **Note:** This file replaces the old `architecture-session-manager.md`.

---

## Overview

The control plane is the central Go backend. It:
- Exposes a ConnectRPC API (protobuf over HTTP/2) consumed by the **Dazzle CLI** and **Web UI** for stage lifecycle, runtime operations, API key, stream destination, and user management
- Uses the Kubernetes client to create/delete/monitor streamer pods on demand
- Proxies CDP (Chrome DevTools Protocol) and WebSocket connections from clients to the correct stage pod
- Serves the compiled web SPA as a static file server
- Runs DB migrations and persists all state to PostgreSQL
- Hosts a legacy MCP server per stage (being superseded by CLI)

---

## Technology Stack

| Category | Technology | Version |
|----------|------------|---------|
| Language | Go | 1.25 |
| RPC Framework | ConnectRPC | v1.19.1 |
| Schema | Protocol Buffers (buf toolchain) | v2 |
| Auth — External | Clerk SDK Go | v2.5.1 |
| Auth — Internal | API key (HMAC-SHA256, prefix `dzl_`) | — |
| Database | PostgreSQL via lib/pq | v1.11.2 |
| K8s Client | k8s.io/client-go | v0.29.3 |
| Encryption | AES-256-GCM (via `crypto/cipher`) | stdlib |
| MCP Server | mcp-go | v0.44.1 |
| Sidecar Client | ConnectRPC (sidecar proto) | — |
| UUID | google/uuid (UUIDv7) | v1.6.0 |

---

## Architecture Pattern

**Service-Oriented Gateway:** A single Go binary acts as the API gateway, Kubernetes controller, and reverse proxy. All external traffic passes through it.

---

## Directory Structure

```
control-plane/
├── main.go              # Entry point: Manager init, HTTP routing, shutdown
├── auth.go              # Authenticator: Clerk JWT + API key verification
├── db.go                # DB connection, migrations, CRUD helpers
├── connect_stage.go     # StageService RPC handlers
├── connect_runtime.go   # RuntimeService RPC handlers (screenshots, streaming, logs, sync, events)
├── pod_client.go        # ConnectRPC client for sidecar communication
├── connect_apikey.go    # ApiKeyService RPC handlers
├── connect_stream.go    # RtmpDestinationService RPC handlers
├── connect_user.go      # UserService RPC handlers
├── live.go              # RTMP ingest auth (on_publish/on_publish_done) + public watch HLS proxy
├── r2.go                # R2Client (Cloudflare R2 via minio-go) + pod termination wait
├── mcp.go               # MCP server setup and tool definitions
├── proto/
│   └── api/v1/
│       ├── stage.proto      # StageService definition
│       ├── apikey.proto     # ApiKeyService definition
│       ├── stream.proto     # RtmpDestinationService definition
│       └── user.proto       # UserService definition
├── gen/api/v1/          # Generated Go + TypeScript protobuf code (buf)
├── migrations/
│   ├── 001_initial.up.sql
│   ├── 002_nullable_direct_port.up.sql
│   ├── 003_endpoints.up.sql
│   ├── 004_rename_session_log_to_stage_log.up.sql
│   └── 005_consolidate_stages.up.sql
└── docker/
    └── Dockerfile
```

---

## Core Component: Manager

`Manager` is the central struct holding all runtime state:

```go
type Manager struct {
    mu               sync.RWMutex
    stages           map[string]*Stage
    previewTokenCache *expirable.LRU[string, string] // token -> stageID
    activateMu       sync.Map                        // per-stage activation locks
    clientset        *kubernetes.Clientset
    namespace        string
    streamerImage    string
    sidecarImage     string
    r2Client         *R2Client
    r2Bucket         string
    podToken         string
    maxStages        int
    imagePullSecrets []corev1.LocalObjectReference
    db               *sql.DB
    auth             *authenticator
    encryptionKey    []byte
    pc               *podClient
    oauth            *oauthHandler
    publicBaseURL    string
}
```

---

## HTTP Routes

**Public port (:8080):**

| Path | Method | Auth | Description |
|------|--------|------|-------------|
| `/health` | GET | none (stats if authed) | Health check |
| `/api.v1.StageService/*` | POST | Clerk or API key | Stage CRUD via ConnectRPC |
| `/api.v1.ApiKeyService/*` | POST | Clerk JWT only | API key CRUD |
| `/api.v1.RtmpDestinationService/*` | POST | Clerk JWT only | Stream destination CRUD |
| `/api.v1.UserService/*` | POST | Clerk JWT only | User profile |
| `/stage/<stage-id>/cdp` | WS | Clerk or API key | CDP WebSocket proxy to Chrome |
| `/stage/<stage-id>/cdp/json/*` | GET | Clerk or API key | CDP discovery (URL-rewritten) |
| `/stage/<id>/hls/*` | GET | preview token or Clerk | HLS proxy (authenticated preview) |
| `/stage/<id>/*` | HTTP/WS | Clerk or API key | HTTP/WS proxy to sidecar on pod (port 8080) |
| `/stage/<id>/mcp/*` | HTTP | Clerk or API key | MCP server (per-stage) |
| `/watch/<slug>/hls/*` | GET | none | Public HLS proxy — resolves slug to stage, proxies sidecar HLS |
| `/watch/<slug>` | GET | none | Watch page SPA (HLS.js player) |
| `/*` | GET | none | Serve web SPA (fallback) |

**Internal port (:9090) — cluster-only, not exposed via ingress:**

| Path | Method | Auth | Description |
|------|--------|------|-------------|
| `/rtmp/on_publish` | POST | none (network-policy restricted) | nginx-rtmp auth callback — validates stream key, creates RTMP session |
| `/rtmp/on_publish_done` | POST | none (network-policy restricted) | nginx-rtmp disconnect callback — ends RTMP session |

---

## Authentication

Two auth paths, unified via `authenticator`:

1. **Clerk JWT** — `Authorization: Bearer <clerk-jwt>` — validated via Clerk SDK; extracts `user_id` and `email`
2. **API Key** — `Authorization: Bearer dzl_<secret>` — HMAC-SHA256 hash compared against `api_keys.key_hash` in DB

`clerkOnly` interceptor additionally blocks API-key auth on sensitive endpoints (ApiKeyService, RtmpDestinationService, UserService).

---

## Stage Lifecycle

```
inactive ──► starting ──► running ──► stopping ──► (deleted)
                                         │
                                         └──► inactive (deactivate, keeps DB record)
```

- **Create**: Provisions a Kubernetes pod (`app=streamer-stage` label, `stage-id` label), sets DB status to `starting`
- **Activate**: If stage is `inactive`, creates pod and waits for readiness (polls every 500ms, up to context deadline)
- **Deactivate**: Deletes pod, sets DB status to `inactive` (record preserved)
- **Delete**: Deletes pod and DB record
- **Recovery**: On restart, lists pods with `app=streamer-stage` label; reconciles in-memory state; resets orphaned DB records to `inactive`
- **GC**: Background loop (5s) deletes stages stuck in `starting` for >3 minutes

---

## CDP Proxy

The control plane provides a stable, authenticated CDP endpoint at `/stage/<stage-id>/cdp`:

- **WebSocket**: Resolves Chrome's real WS URL via `/json/version` on the pod, then raw TCP-proxies the WebSocket upgrade (hijacks both connections, bidirectional `io.Copy`)
- **HTTP discovery** (`/cdp/json/*`): Proxies to pod with token auth; rewrites `webSocketDebuggerUrl` to deterministic external URL `wss://<host>/stage/<stage-id>/cdp`

---

## Streamer Pod Spec

Each stage pod has three containers:

**Init container** (`restore`): Runs `/sidecar restore` from the sidecar image to restore `/data/` from R2 before the main container starts.

**Main container** (`streamer`):
- Image: `STREAMER_IMAGE` env
- CPU: `2` req / `4` limit; Memory: `4Gi` req / `8Gi` limit
- Volumes: `/dev/shm` (2Gi memory), `/data` (shared emptyDir for content + Chrome state), `hls-data` (512Mi emptyDir)
- PreStop hook: `prestop.sh` (kills Chrome, triggers sidecar final sync)

**Sidecar container** (`sidecar`): Go binary from `SIDECAR_IMAGE`.
- Command: `/sidecar serve`
- Port: 8080
- Readiness probe: `GET /_dz_9f7a3b1c/health` on port 8080
- Auth: `TOKEN` env var injected from `browserless-auth` secret
- Resources: CPU `100m` req / `500m` limit; Memory `128Mi` req / `512Mi` limit
- R2 credentials injected as `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` env vars

---

## MCP Server

The control plane hosts an MCP server at `/stage/<id>/mcp/*` using `mcp-go`. Each stage gets its own MCP endpoint. Tools are defined in `mcp.go` and allow AI agents to interact with the stage (emit events, take screenshots, control streaming via `obs` command, get logs).

---

## Database Schema

See `data-models.md` for full schema. Key tables:
- `users` — Clerk user records
- `api_keys` — hashed API keys with prefix
- `stages` — persistent stage records with status, pod info
- `stream_destinations` — per-user RTMP configurations
- `schema_migrations` — migration version tracking

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `CLERK_SECRET_KEY` | Yes | — | Clerk backend API key |
| `ENCRYPTION_KEY` | Yes | — | 32-byte hex AES key for stream key encryption |
| `DB_HOST` | No | `postgres` | PostgreSQL host |
| `DB_PORT` | No | `5432` | PostgreSQL port |
| `DB_USER` | No | `browser_streamer` | DB user |
| `DB_PASSWORD` | No | — | DB password |
| `DB_NAME` | No | `browser_streamer` | DB name |
| `NAMESPACE` | No | `browser-streamer` | Kubernetes namespace |
| `STREAMER_IMAGE` | No | `browser-streamer:latest` | Container image for stage pods |
| `SIDECAR_IMAGE` | No | — | Container image for R2 sync sidecar |
| `POD_TOKEN` | No | — | Internal auth token passed to streamer pods |
| `MAX_STAGES` | No | `3` | Maximum concurrent stages |
| `PORT` | No | `8080` | HTTP listen port |
| `IMAGE_PULL_SECRET` | No | — | K8s imagePullSecret name for stage pods |
| `SCHEDULER_NAME` | No | — | K8s scheduler name for stage pods |
| `PRIORITY_CLASS_NAME` | No | — | K8s PriorityClass for stage pods |
| `R2_ENDPOINT` | No | — | Cloudflare R2 S3-compatible endpoint |
| `R2_ACCESS_KEY_ID` | No | — | R2 access key ID |
| `R2_SECRET_ACCESS_KEY` | No | — | R2 secret access key |
| `R2_BUCKET` | No | — | R2 bucket name for stage storage |
| `OAUTH_REDIRECT_BASE_URL` | No | — | Base URL for OAuth redirect callbacks |
| `PUBLIC_BASE_URL` | No | — | Base URL for preview URLs (e.g., `https://dazzle.fm`) |
