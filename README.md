# Agent Streamer (Dazzle)

On-demand cloud browser environments for AI-driven live streaming and automation. Each **stage** is a Kubernetes pod running Chrome on a headless display with ffmpeg for streaming.

**Primary consumers: the [Dazzle CLI](https://github.com/dazzle-labs/cli) (`dazzle`) and the Web UI.** The CLI is the main interface for developers and AI agents — full stage lifecycle, content sync, screenshots, streaming, and broadcast control via ConnectRPC. The Web UI is the dashboard for account management, stage monitoring, and configuration.

**Production:** https://dazzle.fm

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Primary Consumers                                                   │
│    CLI (dazzle) ─── ConnectRPC ──┐                                   │
│    Web UI ──────── ConnectRPC ───┘                                   │
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
│    /api.v1.RuntimeService/*    sync, screenshots, streaming, logs         │
│    /api.v1.RtmpDestinationService/*  RTMP destinations              │
│    /api.v1.UserService/*       user profile                         │
│    /api.v1.ApiKeyService/*     API key management  [Clerk only]     │
│                                                                     │
│  Watch / HLS  (public, no auth)                                     │
│    GET    /watch/<slug>/hls/*      HLS live stream (m3u8 + .ts)     │
│    GET    /watch/<slug>            Watch page (HLS.js player)       │
│                                                                     │
│  Public                                                             │
│    GET    /health                  health check                     │
│    GET    /stage/*                 SPA (dashboard pages)            │
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
│  Streamer Pod  (per stage, ephemeral)                               │
│                                                                     │
│  Main container (streamer — infrastructure only)                    │
│    Xvfb :99                        Headless X11 display             │
│    Chrome (kiosk mode)             CDP WebSocket :9222             │
│    PulseAudio                      Audio system                    │
│                                                                     │
│  Sidecar container (Go binary :8080)                                │
│    Content sync API (ConnectRPC)   Directory sync from CLI          │
│    Static content serving          Chrome loads from /              │
│    ffmpeg pipeline                 HLS preview + RTMP broadcast    │
│    CDP client                      Screenshots, logs, events       │
│    R2 persistence (minio-go)       Syncs /data/ to Cloudflare R2  │
│                                                                     │
│  Init container (sidecar restore)                                   │
│    Restores /data/ from R2 on stage start                          │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Parts

| Part | Path | Language | Purpose |
|------|------|----------|---------|
| **cli** | `cli/` (git submodule) | Go 1.25 | Primary interface for developers and AI agents — stage lifecycle, directory sync, screenshots, streaming, MCP server |
| **control-plane** | `control-plane/` | Go 1.25 | API server, K8s orchestration, auth, DB, sidecar proxy, serves web SPA |
| **web** | `web/` | TypeScript / React 19 | Dashboard — stage monitoring, API keys, stream destinations, account settings |
| **streamer** | `streamer/` | — | Per-stage infrastructure container: Xvfb, Chrome, PulseAudio. No application code. |
| **sidecar** | `sidecar/` | Go 1.25 | Per-stage application logic: content sync, CDP client, ffmpeg pipeline, R2 persistence, metrics, static content serving |
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

- **CLI (`dazzle`)** — primary developer/agent interface: `dazzle stage up`, `dazzle stage sync`, `dazzle stage screenshot`, `dazzle dest attach`, etc.
- **MCP server** — `dazzle mcp` starts a local MCP server on stdin/stdout for AI agent integration (Claude Desktop, Claude Code, VS Code, Cursor). Provides `cli`, `screenshot`, `guide`, and workspace file tools.
- **Web UI** — dashboard for stage monitoring, API key management, stream destination configuration, and account settings
- **Stage lifecycle** — browser pods move through states: `inactive → starting → running → stopping`. Bring stages up/down via CLI or Web UI; pods are ephemeral, DB records persist.
- **Content sync** — sync directories of HTML/CSS/JS to the stage; browser auto-refreshes on every sync
- **Stream destinations** — RTMP keys for Twitch, YouTube, Kick, custom; AES-256-GCM encrypted at rest
- **API keys** — `dzl_*` prefix, HMAC-SHA256 hashed, with last-used tracking; used by CLI and programmatic clients
- **Stage persistence** — content, Chrome localStorage, and IndexedDB are synced to Cloudflare R2 via a sidecar container and restored on stage activation
- **HLS streaming** — ffmpeg generates an HLS stream from the display, publicly viewable at `/watch/<slug>`
- **Stage recovery** — on restart, reconciles in-memory state with live K8s pods and resets orphaned DB records

---

## Infrastructure

- **Cluster:** Hetzner Cloud k3s HA (3 control-plane nodes, 2 workers, 0–3 autoscaler), provisioned via OpenTofu + kube-hetzner
- **TLS:** cert-manager + Let's Encrypt (automatic)
- **Auth:** Clerk JWT (Web UI) + `dzl_*` API keys (CLI, programmatic)
- **Secrets:** SOPS Age-encrypted YAML — decrypted automatically by Make targets and CI/CD
- **Storage:** Cloudflare R2 — persistent stage content and Chrome state
- **Builds:** GitHub Actions CI/CD — pushes images to Docker Hub, deploys to cluster
- **Networking:** WireGuard node-to-node encryption, Hetzner Load Balancer

---

## Documentation

Full docs in [`docs/`](docs/index.md):

- [Project Overview](docs/project-overview.md)
- [Dazzle CLI Design](docs/dazzle-cli-design.md)
- [Architecture: Control Plane](docs/architecture-control-plane.md)
- [Architecture: Web Frontend](docs/architecture-web.md)
- [Architecture: Streamer Pod](docs/architecture-streamer.md)
- [Integration Architecture](docs/integration-architecture.md)
- [API Contracts](docs/api-contracts.md)
- [Development Guide](docs/development-guide.md)
- [Deployment Guide](docs/deployment-guide.md)
- [Hetzner Infrastructure Deep-Dive](docs/deep-dive-hetzner-k8s-infrastructure.md)
