# Agent Streamer — Documentation Index

> Generated: 2026-03-03 | Last Updated: 2026-03-09 (Go sidecar migration, R2 persistence, HLS preview, preview URLs)

---

## Project Overview

| | |
|-|-|
| **Product** | Dazzle — on-demand cloud browser environments for AI-driven live streaming and automation |
| **Primary Consumers** | Dazzle CLI (`dazzle`) and Web UI |
| **Production URL** | https://dazzle.fm |
| **Repo Type** | Monorepo (7 parts) |
| **Infrastructure** | Hetzner Cloud k3s HA cluster (3 CP + 2 workers + autoscaler 0–3), provisioned via OpenTofu + kube-hetzner |
| **Auth** | Clerk (JWT) + internal API keys (`dzl_*`) |
| **API Protocol** | ConnectRPC (protobuf/HTTP2) |

---

## External Resources

- **[stream-examples](https://github.com/dazzle-labs/stream-examples)** — Open-source example stages, ready to sync and stream

## Quick Reference by Part

### cli (Go CLI — git submodule)
- **Path:** `cli/` (submodule → `github.com/dazzle-labs/cli`)
- **Role:** Primary interface for developers and AI agents — stage lifecycle, content sync, screenshots, streaming
- **Install:** `go install github.com/dazzle-labs/cli@latest`

### control-plane (Go backend)
- **Path:** `control-plane/`
- **Role:** API server, K8s orchestration, auth, DB, sidecar proxy, RTMP ingest auth, serves web SPA
- **Entry:** `control-plane/main.go`
- **Ports:** 8080 (public API + web), 9090 (internal — RTMP callbacks)

### sidecar (Go binary — per-pod)
- **Path:** `sidecar/`
- **Role:** Application logic for stage pods — content sync API, CDP client (logs/events/screenshots), ffmpeg pipeline (HLS preview + RTMP broadcast), R2 persistence, metrics, static content serving
- **Entry:** `sidecar/cmd/sidecar/main.go`
- **Port:** 8080 (inside pod)
- **Proto:** `sidecar/proto/api/v1/sidecar.proto` (ConnectRPC services: SyncService, RuntimeService, ObsService)

### web (React SPA)
- **Path:** `web/`
- **Role:** Dashboard for stage monitoring, API keys, stream destinations, account settings
- **Entry:** `web/src/main.tsx`
- **Dev:** `cd web && npm run dev`

### stage-runtime (Infrastructure container — per-pod)
- **Path:** `stage-runtime/`
- **Role:** Pure infrastructure — Xvfb, Chrome, PulseAudio. No custom application code.
- **Entry:** `stage-runtime/docker/entrypoint.sh`

### ingest (RTMP receiver)
- **Path:** `ingest/`
- **Role:** nginx-rtmp server — receives RTMP streams, transmuxes to HLS (codec copy, no re-encode)
- **Port:** 1935 (RTMP), 8080 (HLS serving)

### stage-runtime (Rust stage runtime)
- **Path:** `stage-runtime-rust/`
- **Role:** Pure-Rust drop-in replacement for Chrome + Xvfb + ffmpeg. V8 runtime with Canvas 2D (tiny-skia), WebGL2 (wgpu), HTML/CSS (html5ever + taffy), Web Audio (web-audio-api crate), and H.264 encoding (ffmpeg-next). Communicates with sidecar via CDP over named pipes. Wire-compatible with Chrome's CDP protocol.
- **Enable:** Set `STREAMER_RENDERER=native` (CPU stages) or `RENDERER=native` (GPU stages). Chrome is the default.
- **Docs:** [Architecture: stage-runtime](./architecture-stage-runtime.md)

### k8s (Infrastructure)
- **Path:** `k8s/`
- **Role:** Kubernetes manifests, Traefik (HTTP + RTMP TCP), TLS, SOPS-encrypted secrets

---

## Documentation

### Architecture
- [Project Overview](./project-overview.md) — Product summary, tech stack, key capabilities
- [Dazzle CLI Design](./dazzle-cli-design.md) — CLI commands, auth flow, proto service changes, implementation plan
- [Architecture: Control Plane](./architecture-control-plane.md) — Go backend: routes, stage lifecycle, sidecar proxy, env vars
- [Architecture: Web Frontend](./architecture-web.md) — React SPA: pages, routing, ConnectRPC client setup
- [Architecture: Streamer Pod](./architecture-streamer.md) — Stage pod: Chrome, ffmpeg pipeline, sidecar
- [Architecture: stage-runtime](./architecture-stage-runtime.md) — Rust stage runtime: V8 engine, Canvas 2D (tiny-skia), WebGL2 (wgpu), HTML/CSS, audio, encoding pipeline
- [Integration Architecture](./integration-architecture.md) — How all parts communicate; data flows
- [Source Tree Analysis](./source-tree-analysis.md) — Annotated directory structure with critical file callouts

### API & Data
- [API Contracts](./api-contracts.md) — All ConnectRPC services (Stage, ApiKey, Stream, User) + HTTP endpoints
- [Data Models](./data-models.md) — PostgreSQL schema, migration history, entity relationships

### Security
- [Cluster Security](./cluster-security.md) — Infrastructure hardening, GitHub OIDC auth, SOPS secrets, pod security, RBAC
- [Network Security](./network-security.md) — NetworkPolicy and CiliumNetworkPolicy rules, per-pod ingress/egress, FQDN-locked external access

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

1. **CLI and Web UI as primary consumers** — The Dazzle CLI (`dazzle`) is the main interface for developers and AI agents, providing full stage lifecycle, content sync, and broadcast control via ConnectRPC. The Web UI serves as the dashboard for account management, monitoring, and configuration.

2. **Control plane as unified gateway** — All external traffic (CLI, Web UI, CDP, WebSocket) routes through one Go binary. Simplifies TLS termination and auth.

3. **Stages are persistent, pods are ephemeral** — A `Stage` DB record survives pod restarts. `ActivateStage` creates a pod on demand; `DeleteStage` removes everything (including R2 storage); `DeactivateStage` deletes pod but keeps record. Content and Chrome state are synced to R2 and restored on next activation.

4. **Streamer + sidecar architecture** — Each stage pod has two main containers: the **streamer** (pure infrastructure: Xvfb, Chrome, PulseAudio) and the **sidecar** (Go binary with all application logic: content sync, CDP client, ffmpeg pipeline, R2 persistence). The sidecar manages ffmpeg directly for HLS preview and RTMP broadcast — no OBS. Chrome loads content from the sidecar via HTTP (`http://localhost:8080/`). All internal APIs live behind `/_dz_9f7a3b1c/` to avoid collisions with user content.

5. **Dazzle-hosted streaming** — Every stage is automatically a live stream on dazzle.fm. The sidecar's always-on HLS output is the dazzle-hosted stream; broadcasting makes it publicly viewable at `/watch/{stageId}` (no auth required). External RTMP sources (OBS) can push to the nginx-rtmp ingest server using the stage's stream key. External platform destinations (Twitch, YouTube, etc.) are optional add-ons.

6. **Protobuf as service contract** — All control-plane ↔ CLI/web communication uses generated ConnectRPC code from `proto/api/v1/`. The sidecar also uses ConnectRPC internally (`sidecar/proto/`). No hand-written API clients.

7. **SOPS for secrets** — All production secrets are Age-encrypted at rest (4 recipients); decrypted at apply time by CI/CD or locally via Age key. AES-256-GCM used for stream keys within the DB.

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
