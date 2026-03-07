# Agent Streamer — Project Overview

**Last updated:** 2026-03-03
**Repository type:** Monorepo (4 parts)

---

## Executive Summary

Agent Streamer (branded as **Dazzle**) is a cloud-native platform that provides on-demand, isolated browser environments for AI-driven live streaming and browser automation. Each "stage" is a Kubernetes pod running Chrome on a headless display with OBS for streaming.

**Primary consumers are the Dazzle CLI (`dazzle`) and the Web UI.** The CLI is the main interface for AI agents and developers — it provides full stage lifecycle management, script control, screenshots, OBS operations, and streaming via ConnectRPC. The Web UI is the dashboard for account management, stage monitoring, API keys, and stream destination configuration.

Primary use cases: AI agents that need a persistent browser (Claude Code, OpenAI Agents, etc.), live streaming to Twitch/YouTube/Kick via RTMP, and programmatic browser automation.

---

## Parts

| Part | Path | Language | Purpose |
|------|------|----------|---------|
| **control-plane** | `control-plane/` | Go 1.24 | Backend API, Kubernetes orchestration, auth, DB, CDP/WS proxy, MCP server, serves web SPA |
| **web** | `web/` | TypeScript / React 19 | Web dashboard SPA (stage management, API keys, stream destinations) |
| **streamer** | `streamer/` | Node.js | Per-stage browser container: Express HTTP, Chrome CDP, Vite panel rendering |
| **k8s** | `k8s/` | YAML | Kubernetes manifests, Traefik ingress, TLS, SOPS-encrypted secrets |

---

## Technology Stack

| Category | Technology | Version |
|----------|------------|---------|
| **Control Plane Language** | Go | 1.24 |
| **RPC Framework** | ConnectRPC (Protobuf/HTTP2) | v1.19 |
| **Auth** | Clerk (JWT) + internal API keys | SDK Go v2 / React v5 |
| **Database** | PostgreSQL | 16 (Alpine) |
| **Encryption** | AES-256-GCM (stream keys at rest) | — |
| **K8s Client** | k8s.io/client-go | v0.29.3 |
| **MCP** | mcp-go | v0.44.1 |
| **Frontend Framework** | React | 19 |
| **Build Tool** | Vite | 6.x |
| **CSS** | Tailwind CSS | v4 |
| **Routing** | React Router | v7 |
| **Video Playback** | HLS.js | v1.6 |
| **Streamer Server** | Express | 4 |
| **WebSocket** | ws | v8 |
| **Panel State** | Zustand | v5 |
| **Ingress** | Traefik | — |
| **TLS** | cert-manager + Let's Encrypt | — |
| **Secrets** | SOPS-encrypted YAML | — |
| **Orchestration** | k3s (Kubernetes) | v1.29+ |

---

## Architecture Pattern

```
CLI (dazzle) ──► Traefik Ingress (TLS termination)
Web UI ────────►         │
                         ▼
                Control Plane (Go :8080)
           ├── ConnectRPC API (/api.v1.*)
           │   ├── StageService (create/list/get/delete)
           │   ├── ApiKeyService (CRUD, Clerk-only)
           │   ├── RuntimeService (script, screenshots, OBS, logs)
           │   ├── RtmpDestinationService (RTMP destinations)
           │   └── UserService (profile)
           ├── CDP Proxy (/stage/<stage-id>/cdp)
           ├── Stage HTTP/WS Proxy (/stage/<id>/*)
           ├── Health (/health)
           └── Web SPA (fallback /)
                    │
              creates/manages pods
                    │
                    ▼
           Streamer Pod (per stage, on-demand)
           ├── Express HTTP :8080
           │   ├── Panel API (/api/panels/*)
           │   ├── CDP discovery proxy (/json/*)
           │   └── Health (/health)
           ├── Chrome/Chromium on Xvfb
           │   └── CDP on localhost:9222
           └── Vite HMR dev server (panel JSX rendering)
```

---

## Key Capabilities

1. **CLI (`dazzle`)** — Primary developer/agent interface: stage lifecycle, script set/get/edit, screenshots, logs, OBS control, destination management — all via ConnectRPC
2. **Web UI** — Dashboard for stage monitoring, API key management, stream destination configuration, and account settings
3. **Stage lifecycle** — Create/activate/deactivate/delete browser pods with status tracking (inactive → starting → running → stopping)
4. **CDP access** — Full Chrome DevTools Protocol access proxied through control plane; WebSocket URL rewriting for external access
5. **MCP server** *(legacy)* — Per-stage Model Context Protocol endpoint; being superseded by the CLI
6. **Panel system** — Streamer manages named panels; supports hot-swap via Vite HMR without page reload
7. **Stream destinations** — RTMP stream keys for Twitch, YouTube, Kick, custom; AES-256-GCM encrypted at rest
8. **API keys** — `bstr_*` prefix format, HMAC-SHA256 hashed, with last-used tracking; used by CLI and programmatic clients
9. **Stage recovery** — On restart, reconciles in-memory state with live Kubernetes pods and resets orphaned DB records

---

## Domain & Hosting

- **Production URL:** `https://stream.dazzle.fm`
- **Infrastructure:** Hetzner Cloud k3s HA cluster (3 CP + 2 workers + autoscaler 0–3), provisioned via OpenTofu + kube-hetzner
- **TLS:** Automatic via cert-manager + Let's Encrypt ACME
