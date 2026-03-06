# Browser Streamer — Documentation Index

> Generated: 2026-03-03 | Last Updated: 2026-03-05 | Deep-Dives: 1

---

## Project Overview

| | |
|-|-|
| **Product** | Dazzle — on-demand cloud browser environments for AI agents and live streaming |
| **Production URL** | https://stream.dazzle.fm |
| **Repo Type** | Monorepo (5 parts) |
| **Infrastructure** | Single Hetzner VPS, k3s (single-node Kubernetes) |
| **Auth** | Clerk (JWT) + internal API keys (`bstr_*`) |
| **API Protocol** | ConnectRPC (protobuf/HTTP2) |

---

## Quick Reference by Part

### control-plane (Go backend)
- **Path:** `control-plane/`
- **Role:** API server, K8s orchestration, auth, DB, CDP/WS proxy, MCP server, serves web SPA
- **Entry:** `control-plane/main.go`
- **Port:** 8080

### web (React SPA)
- **Path:** `web/`
- **Role:** Dashboard for stage management, API keys, stream destinations
- **Entry:** `web/src/main.tsx`
- **Dev:** `cd web && npm run dev`

### runtime (Browser runtime bundles)
- **Path:** `runtime/`
- **Role:** Compiled browser-side code: `prelude.js` (React/ReactDOM/Zustand globals) + `renderer.js` (spec-driven renderer with 37 components)
- **Entry:** `runtime/renderer.tsx`, `runtime/prelude.ts`
- **Build:** `cd runtime && npm run build` (outputs `dist/prelude.js` + `dist/renderer.js`)
- **Core types:** `runtime/core/` — Spec, PatchOp, expressions, timeline (shared with harness)
- **Components:** `runtime/components/` — 37 TSX components across 8 categories (Layout, Text, Content, Broadcast, SVG, Animation, Data, Coding)

### streamer (Node.js browser pod)
- **Path:** `streamer/`
- **Role:** Chrome + OBS + panel rendering (Vite HMR) — ephemeral K8s pod
- **Entry:** `streamer/index.js`

### k8s (Infrastructure)
- **Path:** `k8s/`
- **Role:** Kubernetes manifests, Traefik, TLS, SOPS-encrypted secrets

---

## Documentation

### Architecture
- [Project Overview](./project-overview.md) — Product summary, tech stack, key capabilities
- [Architecture: Control Plane](./architecture-control-plane.md) — Go backend: routes, stage lifecycle, CDP proxy, MCP, env vars
- [Architecture: Web Frontend](./architecture-web.md) — React SPA: pages, routing, ConnectRPC client setup
- [Architecture: Streamer Pod](./architecture-streamer.md) — Node.js: panel system, Chrome, OBS, Vite HMR
- [Integration Architecture](./integration-architecture.md) — How all parts communicate; data flows
- [Source Tree Analysis](./source-tree-analysis.md) — Annotated directory structure with critical file callouts

### API & Data
- [API Contracts](./api-contracts.md) — All ConnectRPC services (Stage, ApiKey, Stream, User) + HTTP endpoints
- [Data Models](./data-models.md) — PostgreSQL schema, migration history, entity relationships

### Deep-Dive Documentation

Detailed exhaustive analysis of specific areas:

- [Runtime & Harness Deep-Dive](./deep-dive-runtime-harness.md) — Comprehensive analysis of the spec-driven rendering engine (37 components, timeline, expressions) and evaluation harness (14 scenarios, agent orchestration, replay, multimodal evaluation) — 65 files, ~7,500 LOC — Generated 2026-03-05

### Operations
- [Local Development (Kind)](./local-dev.md) — Run the full stack locally with Kind (recommended for new devs)
- [Development Guide](./development-guide.md) — Remote build commands, protobuf regen, secret management
- [Deployment Guide](./deployment-guide.md) — k3s deployment, TLS setup, provisioning, monitoring

---

## Getting Started

### Local development (recommended)
```bash
# Start full stack locally (secrets are SOPS-encrypted, decrypted automatically)
make local-up

# Start web dev server (in another terminal)
cd web && npm install && npm run dev
# Open http://localhost:5173
```

See **[Local Development (Kind)](./local-dev.md)** for the full guide.

### Remote build and deploy
```bash
make build HOST=<vps-ip> CLERK_PK=pk_live_...
make deploy HOST=<vps-ip>
```

### Check production status
```bash
make status
make logs-cp
```

### Regenerate protobuf code
```bash
make proto
```

---

## Key Architectural Decisions

1. **Control plane as unified gateway** — All external traffic (API, CDP, MCP, WebSocket, SPA) routes through one Go binary. Simplifies TLS termination and auth.

2. **Stages are persistent, pods are ephemeral** — A `Stage` DB record survives pod restarts. `GetStage` activates (creates pod) on demand; `DeleteStage` removes everything; `DeactivateStage` deletes pod but keeps record.

3. **Panel system replaces template engine** — The streamer's Vite HMR panel system hot-swaps JavaScript/JSX without page reloads. Panels persist state via `emit_event` + `window.__state`.

4. **Protobuf as service contract** — All control-plane ↔ web communication uses generated ConnectRPC code from `proto/api/v1/`. No hand-written API clients.

5. **SOPS for secrets** — All production secrets are encrypted at rest; decrypted only during `make secrets`. AES-256-GCM used for stream keys within the DB.

---

## Note on Superseded Files

The following old docs exist but have been replaced by the updated files above:
- `architecture-dashboard.md` → replaced by `architecture-web.md`
- `architecture-session-manager.md` → replaced by `architecture-control-plane.md`
- `RESCAN-INDEX.md`, `rescan-summary.md`, `rescan-findings.json` → superseded by this 2026-03-03 rescan
