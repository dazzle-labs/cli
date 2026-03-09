# Agent Streamer — Documentation Index

> Generated: 2026-03-03 | Last Updated: 2026-03-09 (R2 persistence, sidecar, HLS preview, preview URLs)

---

## Project Overview

| | |
|-|-|
| **Product** | Dazzle — on-demand cloud browser environments for AI-driven live streaming and automation |
| **Primary Consumers** | Dazzle CLI (`dazzle`) and Web UI |
| **Production URL** | https://stream.dazzle.fm |
| **Repo Type** | Monorepo (5 parts) |
| **Infrastructure** | Hetzner Cloud k3s HA cluster (3 CP + 2 workers + autoscaler 0–3), provisioned via OpenTofu + kube-hetzner |
| **Auth** | Clerk (JWT) + internal API keys (`dzl_*`) |
| **API Protocol** | ConnectRPC (protobuf/HTTP2) |

---

## Quick Reference by Part

### cli (Go CLI — git submodule)
- **Path:** `cli/` (submodule → `github.com/dazzle-labs/cli`)
- **Role:** Primary interface for developers and AI agents — stage lifecycle, scripting, screenshots, OBS, streaming
- **Install:** `go install github.com/dazzle-labs/cli@latest`

### control-plane (Go backend)
- **Path:** `control-plane/`
- **Role:** API server, K8s orchestration, auth, DB, CDP/WS proxy, serves web SPA
- **Entry:** `control-plane/main.go`
- **Port:** 8080

### web (React SPA)
- **Path:** `web/`
- **Role:** Dashboard for stage monitoring, API keys, stream destinations, account settings
- **Entry:** `web/src/main.tsx`
- **Dev:** `cd web && npm run dev`

### streamer (Node.js browser pod)
- **Path:** `streamer/`
- **Role:** Chrome + OBS + panel rendering (Vite HMR) + HLS preview — ephemeral K8s pod
- **Entry:** `streamer/index.js`
- **Sidecar:** `streamer/docker/sidecar/` — rclone-based R2 sync for content and Chrome state persistence

### k8s (Infrastructure)
- **Path:** `k8s/`
- **Role:** Kubernetes manifests, Traefik, TLS, SOPS-encrypted secrets

---

## Documentation

### Architecture
- [Project Overview](./project-overview.md) — Product summary, tech stack, key capabilities
- [Dazzle CLI Design](./dazzle-cli-design.md) — CLI commands, auth flow, proto service changes, implementation plan
- [Architecture: Control Plane](./architecture-control-plane.md) — Go backend: routes, stage lifecycle, CDP proxy, MCP, env vars
- [Architecture: Web Frontend](./architecture-web.md) — React SPA: pages, routing, ConnectRPC client setup
- [Architecture: Streamer Pod](./architecture-streamer.md) — Node.js: panel system, Chrome, OBS, Vite HMR
- [Integration Architecture](./integration-architecture.md) — How all parts communicate; data flows
- [Source Tree Analysis](./source-tree-analysis.md) — Annotated directory structure with critical file callouts

### API & Data
- [API Contracts](./api-contracts.md) — All ConnectRPC services (Stage, ApiKey, Stream, User) + HTTP endpoints
- [Data Models](./data-models.md) — PostgreSQL schema, migration history, entity relationships

### Operations
- [Local Development (Kind)](./local-dev.md) — Run the full stack locally with Kind (recommended for new devs)
- [Development Guide](./development-guide.md) — Remote build commands, protobuf regen, secret management
- [Deployment Guide](./deployment-guide.md) — k3s deployment, TLS setup, provisioning, monitoring

---

## Getting Started

### Local development (recommended)
```bash
make dev    # Builds everything, starts Kind cluster, runs web dev server + log tail
```

See **[Local Development (Kind)](./local-dev.md)** for the full guide.

### Remote deployment
Remote builds and deploys are managed by **CI/CD** (GitHub Actions). Pushing to `main` triggers the pipeline which builds images, pushes to Docker Hub, and deploys to the Hetzner cluster.

### Check production status
```bash
make prod/status    # Show pods and services on prod cluster
```

### Regenerate protobuf code
```bash
make proto
```

---

## Key Architectural Decisions

1. **CLI and Web UI as primary consumers** — The Dazzle CLI (`dazzle`) is the main interface for developers and AI agents, providing full stage lifecycle, scripting, and OBS control via ConnectRPC. The Web UI serves as the dashboard for account management, monitoring, and configuration.

2. **Control plane as unified gateway** — All external traffic (CLI, Web UI, CDP, WebSocket) routes through one Go binary. Simplifies TLS termination and auth.

3. **Stages are persistent, pods are ephemeral** — A `Stage` DB record survives pod restarts. `ActivateStage` creates a pod on demand; `DeleteStage` removes everything (including R2 storage); `DeactivateStage` deletes pod but keeps record. Content and Chrome state are synced to R2 and restored on next activation.

4. **Panel system replaces template engine** — The streamer's Vite HMR panel system hot-swaps JavaScript/JSX without page reloads. Panels persist state via `emit_event` + `window.__state`.

5. **Protobuf as service contract** — All control-plane ↔ CLI/web communication uses generated ConnectRPC code from `proto/api/v1/`. No hand-written API clients.

6. **SOPS for secrets** — All production secrets are Age-encrypted at rest (4 recipients); decrypted at apply time by CI/CD or locally via Age key. AES-256-GCM used for stream keys within the DB.

---

## Note on Superseded Files

The following old docs exist but have been replaced by the updated files above:
- `architecture-dashboard.md` → replaced by `architecture-web.md`
- `architecture-session-manager.md` → replaced by `architecture-control-plane.md`
- `RESCAN-INDEX.md`, `rescan-summary.md`, `rescan-findings.json` → superseded by this 2026-03-03 rescan

---

## Deep-Dive Documentation

Detailed exhaustive analysis of specific areas:

- [Hetzner k3s Infrastructure & K8s Manifests Deep-Dive](./deep-dive-hetzner-k8s-infrastructure.md) - Comprehensive analysis of `k8s/hetzner/` + `k8s/`: cluster provisioning via kube-hetzner, Kubernetes manifests, secrets management, CI/CD deployment pipeline (28 files, ~650 LOC) - Generated 2026-03-07
