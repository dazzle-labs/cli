# Agent Streamer (Dazzle)

On-demand cloud browser environments for AI agents and live streaming. Each **stage** is a Kubernetes pod running Chrome on a headless display, accessible via Chrome DevTools Protocol (CDP) and a web dashboard.

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
│  Hetzner Load Balancer → Traefik Ingress (TLS, Let's Encrypt)       │
└──────────────────────────────┬──────────────────────────────────────┘
                               │ HTTP / WS  :8080
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│  control-plane  (Go, :8080)                                         │
│                                                                     │
│  ConnectRPC (POST, Clerk JWT or API key)                            │
│    /api.v1.StageService/*      stage CRUD + lifecycle               │
│    /api.v1.ApiKeyService/*     API key management  [Clerk only]     │
│    /api.v1.RtmpDestinationService/*  RTMP destinations [Clerk only] │
│    /api.v1.UserService/*       user profile        [Clerk only]     │
│                                                                     │
│  Stage routes  (all require Clerk JWT or API key)                   │
│    GET/WS /stage/<id>/cdp          CDP WebSocket proxy to Chrome    │
│    GET    /stage/<id>/cdp/json/*   CDP discovery (WS URL rewritten) │
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
| **control-plane** | `control-plane/` | Go 1.24 | API server, K8s orchestration, auth, DB, CDP proxy, serves web SPA |
| **web** | `web/` | TypeScript / React 19 | Dashboard — stage management, API keys, stream destinations |
| **streamer** | `streamer/` | Node.js 20 | Per-stage browser pod: Chrome, OBS, Vite panel rendering |
| **k8s** | `k8s/` | YAML + HCL | Kubernetes manifests, Traefik ingress, TLS, SOPS secrets, cluster provisioning |

---

## Prerequisites

| Tool | Purpose |
|------|---------|
| Docker Desktop (8GB+ RAM) | Local Kind cluster |
| [Kind](https://kind.sigs.k8s.io/) | Local Kubernetes cluster |
| kubectl | Interact with the cluster |
| [SOPS](https://github.com/getsops/sops) + Age key | Decrypt secrets (handled automatically by Make targets) |

---

## Quick Start

```bash
make dev    # Build everything, start Kind cluster, run all dev watchers
```

This single command builds all images, creates a Kind cluster, deploys the full stack, then starts web dev server + control-plane log tail. See [Local Development](docs/local-dev.md) for details.

- **Control plane API:** http://localhost:8080
- **Web dashboard:** http://localhost:5173

### Develop web frontend only

Requires the control-plane running on `:8080` (via `make up`).

```bash
make web/dev
```

### Verify Go backend compiles

```bash
cd control-plane && go build -o /dev/null . && go vet ./...
```

### Deploy to production

Production builds and deploys are handled by **CI/CD** (GitHub Actions). Push to `main` to trigger the pipeline.

### Monitor production

```bash
make prod/status    # Show prod cluster nodes and pods
```

---

## Key Capabilities

- **Stage lifecycle** — browser pods move through states: `inactive → starting → running → stopping`. `GetStage` activates on demand; `DeactivateStage` removes the pod but keeps the DB record; `DeleteStage` removes everything.
- **CDP access** — full Chrome DevTools Protocol proxied through control plane at `/stage/<stage-id>/cdp`
- **Panel system** — hot-swap JavaScript/JSX via Vite HMR without page reload; state persists via `emit_event` + `window.__state`
- **Stream destinations** — RTMP keys for Twitch, YouTube, Kick, custom; AES-256-GCM encrypted at rest
- **API keys** — `bstr_*` prefix, HMAC-SHA256 hashed, with last-used tracking; authenticate via `Authorization: Bearer <key>`
- **Stage recovery** — on restart, reconciles in-memory state with live K8s pods and resets orphaned DB records

---

## Infrastructure

- **Cluster:** Hetzner Cloud k3s HA (3 control-plane nodes, 2 workers, 0–3 autoscaler), provisioned via OpenTofu + kube-hetzner
- **TLS:** cert-manager + Let's Encrypt (automatic)
- **Auth:** Clerk JWT (dashboard/API) + internal `bstr_*` API keys (programmatic)
- **Secrets:** SOPS Age-encrypted YAML — decrypted automatically by Make targets and CI/CD
- **Builds:** GitHub Actions CI/CD — pushes images to Docker Hub, deploys to cluster
- **Networking:** WireGuard node-to-node encryption, Hetzner Load Balancer

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
- [Hetzner Infrastructure Deep-Dive](docs/deep-dive-hetzner-k8s-infrastructure.md)
