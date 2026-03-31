# Agent Streamer — Project Overview

**Last updated:** 2026-03-03
**Repository type:** Monorepo (5 parts)

---

## Executive Summary

Agent Streamer (branded as **Dazzle**) is a cloud-native platform that provides on-demand, isolated browser environments for AI-driven live streaming and browser automation. Each "stage" is a Kubernetes pod running Chrome on a headless display with ffmpeg for streaming.

**Primary consumers are the Dazzle CLI (`dazzle`) and the Web UI.** The CLI is the main interface for AI agents and developers — it provides full stage lifecycle management, content sync, screenshots, broadcast control, and streaming via ConnectRPC. The Web UI is the dashboard for account management, stage monitoring, API keys, and stream destination configuration.

Primary use cases: AI agents that need a persistent browser (Claude Code, OpenAI Agents, etc.), live streaming to Twitch/YouTube/Kick via RTMP, and programmatic browser automation.

---

## Parts

| Part | Path | Language | Purpose |
|------|------|----------|---------|
| **cli** | `cli/` (git submodule → `dazzle-labs/cli`) | Go 1.25 | Primary interface for developers and AI agents — stage lifecycle, content sync, screenshots, streaming |
| **control-plane** | `control-plane/` | Go 1.25 | Backend API, Kubernetes orchestration, auth, DB, sidecar proxy, serves web SPA |
| **web** | `web/` | TypeScript / React 19 | Web dashboard SPA (stage monitoring, API keys, stream destinations, account settings) |
| **streamer** | `streamer/` | — | Per-stage infrastructure container: Xvfb, Chrome, PulseAudio. No custom application code. |
| **sidecar** | `sidecar/` | Go 1.25 | Per-stage application logic: content sync API, CDP client (logs/events/screenshots), ffmpeg pipeline (HLS + RTMP), R2 persistence, Prometheus metrics, static content serving |
| **k8s** | `k8s/` | YAML | Kubernetes manifests, Traefik ingress, TLS, SOPS-encrypted secrets |

---

## Technology Stack

| Category | Technology | Version |
|----------|------------|---------|
| **Control Plane Language** | Go | 1.25 |
| **RPC Framework** | ConnectRPC (Protobuf/HTTP2) | v1.19 |
| **Auth** | Clerk (JWT) + internal API keys | SDK Go v2 / React v5 |
| **Database** | PostgreSQL | 16 (Alpine) |
| **Encryption** | AES-256-GCM (stream keys at rest) | — |
| **K8s Client** | k8s.io/client-go | v0.29.3 |
| **MCP (CLI)** | mcp-go (in CLI) | v0.44.1 |
| **Frontend Framework** | React | 19 |
| **Build Tool** | Vite | 6.x |
| **CSS** | Tailwind CSS | v4 |
| **Routing** | React Router | v7 |
| **Video Playback** | HLS.js | v1.6 |
| **Sidecar RPC** | ConnectRPC (Protobuf) | — |
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
           │   ├── StageService (create/list/get/delete/activate/deactivate)
           │   ├── RuntimeService (sync, screenshots, streaming, logs)
           │   ├── RtmpDestinationService (RTMP destinations)
           │   ├── UserService (profile)
           │   └── ApiKeyService (CRUD, Clerk JWT only)
           ├── Watch/HLS proxy (/watch/<slug>/*)
           ├── Health (/health)
           └── Web SPA (fallback /)
                    │
              creates/manages pods
                    │
                    ▼
           Streamer Pod (per stage, on-demand)
           ├── Init: restore.sh (restore /data/ from R2)
           ├── Main container (streamer — infrastructure only)
           │   ├── Chrome on Xvfb (CDP :9222)
           │   └── PulseAudio
           └── Sidecar: Go binary :8080
               ├── Content sync API + static serving
               ├── CDP client (logs, events, screenshots)
               ├── ffmpeg pipeline (HLS preview + RTMP broadcast)
               └── R2 persistence (minio-go)
```

---

## Key Capabilities

1. **CLI (`dazzle`)** — Primary developer/agent interface: stage lifecycle, directory sync, screenshots, logs, broadcast control, destination management — all via ConnectRPC
2. **Web UI** — Dashboard for stage monitoring, API key management, stream destination configuration, and account settings
3. **Stage lifecycle** — Create/activate/deactivate/delete browser pods with status tracking (inactive → starting → running → stopping)
4. **CDP** — Internal-only between sidecar and Chrome within each pod (pipe or WebSocket mode); not exposed externally
5. **MCP server** — Built into the CLI (`dazzle mcp`); provides tools for AI agent integration via stdin/stdout
6. **Content sync** — Content synced from CLI as directory snapshots; sidecar serves content via HTTP, Chrome loads from sidecar
7. **Stream destinations** — RTMP stream keys for Twitch, YouTube, Kick, custom; AES-256-GCM encrypted at rest
8. **API keys** — `dzl_*` prefix format, HMAC-SHA256 hashed, with last-used tracking; used by CLI and programmatic clients
9. **Stage persistence** — Content, Chrome localStorage, and IndexedDB are synced to Cloudflare R2 via the Go sidecar (minio-go SDK) and restored on next activation
10. **HLS preview** — ffmpeg generates a low-latency HLS stream from the display, proxied through the control plane with shareable `dpt_*` preview tokens
11. **Stage recovery** — On restart, reconciles in-memory state with live Kubernetes pods and resets orphaned DB records

---

## Domain & Hosting

- **Production URL:** `https://dazzle.fm`
- **Infrastructure:** Hetzner Cloud k3s HA cluster (3 CP + 2 workers + autoscaler 0–3), provisioned via OpenTofu + kube-hetzner
- **TLS:** Automatic via cert-manager + Let's Encrypt ACME
