# Browser Streamer (Dazzle)

On-demand cloud browser environments for AI agents and live streaming. Each **stage** is a Kubernetes pod running Chrome on a headless display, accessible via Chrome DevTools Protocol (CDP), an MCP server, and a web dashboard.

**Production:** https://stream.dazzle.fm

---

## Architecture

```
User/Agent ──► Traefik (TLS)
                    │
                    ▼
           control-plane (Go :8080)
           ├── ConnectRPC API (/api.v1.*)
           │   ├── StageService
           │   ├── ApiKeyService
           │   ├── StreamService
           │   └── UserService
           ├── CDP Proxy (/cdp/<stage-id>)
           ├── Stage HTTP/WS Proxy (/stage/<id>/*)
           ├── MCP Server (/stage/<id>/mcp/*)
           └── Web SPA (static fallback)
                    │
              creates/manages pods
                    │
                    ▼
           Streamer Pod (per stage, ephemeral)
           ├── Express HTTP :8080
           ├── Chrome on Xvfb (CDP :9222)
           └── Vite HMR (panel hot-swap)
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
| [SOPS](https://github.com/getsops/sops) | Decrypt secrets (`make secrets`) |
| SSH access to VPS | Remote builds via buildkit |
| [Clerk](https://clerk.com) account | Auth — provides your `CLERK_PK` public key |

Builds happen **remotely** on the VPS via SSH + buildkit. No local Docker daemon required.

---

## Quick Start

### Develop locally (web frontend only)

Requires the control-plane running on `:8080` (deployed or local).

```bash
cd web && npm install && npm run dev
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
- **CDP access** — full Chrome DevTools Protocol proxied through control plane at `/cdp/<stage-id>`
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
- **Secrets:** SOPS-encrypted YAML — run `make secrets` to decrypt and apply
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
