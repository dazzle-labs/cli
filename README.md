# Browser Streamer (Dazzle)

On-demand cloud browser environments for AI agents and live streaming. Each **stage** is a Kubernetes pod running Chrome on a headless display, accessible via Chrome DevTools Protocol (CDP), an MCP server, and a web dashboard.

**Production:** https://stream.dazzle.fm

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Client (Browser / AI Agent / curl)                                 │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTPS / WSS  :443
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Traefik Ingress  (TLS termination, cert-manager + Let's Encrypt)   │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP / WS  :8080
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  control-plane  (Go, :8080)                                         │
│                                                                     │
│  ConnectRPC (POST, Clerk JWT or API key)                            │
│    /api.v1.StageService/*      stage CRUD + lifecycle               │
│    /api.v1.ApiKeyService/*     API key management  [Clerk only]     │
│    /api.v1.RtmpDestinationService/*     RTMP destinations   [Clerk only]     │
│    /api.v1.UserService/*       user profile        [Clerk only]     │
│                                                                     │
│  Stage routes  (all require Clerk JWT or API key)                   │
│    GET/WS /stage/<id>/cdp          CDP WebSocket proxy to Chrome    │
│    GET    /stage/<id>/cdp/json/*   CDP discovery (WS URL rewritten) │
│    *      /stage/<id>/mcp/*        MCP server (AI agent tools)      │
│    *      /stage/<id>/hls/*        HLS live preview (m3u8 + .ts)    │
│    *      /stage/<id>/*            HTTP/WS reverse proxy to pod     │
│                                                                     │
│  Public                                                             │
│    GET    /health                  health check                     │
│    GET    /*                       Web SPA (React, static files)    │
│                                                                     │
│  Internal                                                           │
│    PostgreSQL  :5432               stages, api_keys, streams, users │
│    k8s API     (in-cluster)        create / delete streamer pods    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ creates pods on demand
                               │ talks to pod via pod IP :8080
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Streamer Pod  (Node.js + Chrome, ephemeral, one per stage)         │
│                                                                     │
│  Express HTTP  :8080                                                │
│    GET  /health                    readiness probe                  │
│    *    /api/panels/*              panel management API             │
│    GET  /json/*                    CDP discovery (proxied from CP)  │
│                                                                     │
│  Chrome  (headless, Xvfb :99)                                       │
│    CDP WebSocket  :9222            Chrome DevTools Protocol         │
│                                                                     │
│  Vite HMR dev server  :5173                                         │
│    panel JSX hot-swap (set_script / edit_script)                    │
│                                                                     │
│  OBS Studio  (WebSocket :4455)                                      │
│    streaming to RTMP destinations (Twitch / YouTube / Kick)        │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Parts

| Part | Path | Language | Purpose |
|------|------|----------|---------|
| **control-plane** | `control-plane/` | Go 1.24 | API server, K8s orchestration, auth, DB, CDP proxy, MCP, serves web SPA |
| **web** | `web/` | TypeScript / React 19 | Dashboard — stage management, API keys, stream destinations |
| **streamer** | `streamer/` | Node.js 20 | Per-stage browser pod: Chrome, OBS, Vite panel rendering |
| **k8s** | `k8s/` | YAML | Kubernetes manifests, Traefik ingress, TLS, SOPS secrets |

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| Go 1.24+ | Build the control-plane |
| Node.js 20+ | Build/run the web frontend and streamer |
| kubectl | Interact with the k3s cluster |
| [SOPS](https://github.com/getsops/sops) | Decrypt secrets (used automatically by `make local-up` and `make deploy-secrets`) |
| SSH access to VPS | Remote builds via buildkit |
| [Clerk](https://clerk.com) account | Auth — provides your `CLERK_PK` public key |

Builds happen **remotely** on the VPS via SSH + buildkit. No local Docker daemon required.

---

## Quick Start

```bash
make dev    # Build everything, start Kind cluster, run all dev watchers
```

This single command builds all images, creates a Kind cluster, deploys the full stack, then starts runtime watcher + web dev server + control-plane log tail. Requires Docker Desktop (8GB+ RAM), Kind, kubectl, and SOPS. See [Local Development](docs/local-dev.md) for details.

- **Control plane API:** http://localhost:8080
- **Web dashboard:** http://localhost:5173

### Develop web frontend only

Requires the control-plane running on `:8080` (via `make up` or remote).

```bash
make web/dev
```

### Verify Go backend compiles

```bash
cd control-plane && go build -o /dev/null . && go vet ./...
```

### Build and deploy to production

`HOST` is your VPS IP. `CLERK_PK` is your Clerk publishable key (`pk_live_...` or `pk_test_...`), found in the Clerk dashboard under API Keys.

```bash
make build HOST=<vps-ip> CLERK_PK=pk_live_...
make deploy HOST=<vps-ip>
```

### Monitor production

```bash
make status    # pods, services, ingress, certificates
make logs-cp   # tail control-plane logs
```

---

## Key Capabilities

- **Stage lifecycle** — browser pods move through states: `inactive → starting → running → stopping`. `GetStage` activates on demand; `DeactivateStage` removes the pod but keeps the DB record; `DeleteStage` removes everything.
- **CDP access** — full Chrome DevTools Protocol proxied through control plane at `/stage/<stage-id>/cdp`
- **MCP server** — per-stage Model Context Protocol tools: `set_script`, `edit_script`, `emit_event`, `screenshot`, OBS controls
- **Panel system** — hot-swap JavaScript/JSX via Vite HMR without page reload; state persists via `emit_event` + `window.__state`
- **Stream destinations** — RTMP keys for Twitch, YouTube, Kick, custom; AES-256-GCM encrypted at rest
- **API keys** — `bstr_*` prefix, HMAC-SHA256 hashed, with last-used tracking; authenticate via `Authorization: Bearer <key>`
- **Stage recovery** — on restart, reconciles in-memory state with live K8s pods and resets orphaned DB records

---

## Infrastructure

- **Host:** Single Hetzner VPS, k3s (single-node Kubernetes)
- **TLS:** cert-manager + Let's Encrypt (automatic)
- **Auth:** Clerk JWT (dashboard/API) + internal `bstr_*` API keys (programmatic)
- **Secrets:** SOPS-encrypted YAML — decrypted automatically during `make local-up` / `make deploy`; `make deploy-secrets` for manual application
- **Builds:** Remote SSH + buildkit — no local Docker required
- **Limits:** HostPort range 31000–31099 caps concurrent sessions at 100

---

## Documentation

Full docs in [`docs/`](docs/index.md):

- [Project Overview](docs/project-overview.md)
- [Architecture: Control Plane](docs/architecture-control-plane.md)
- [Architecture: Web Frontend](docs/architecture-web.md)
- [Architecture: Streamer Pod](docs/architecture-streamer.md)
- [Integration Architecture](docs/integration-architecture.md)
- [API Contracts](docs/api-contracts.md)
- [Development Guide](docs/development-guide.md)
- [Deployment Guide](docs/deployment-guide.md)
