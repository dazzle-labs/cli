# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Architecture

Session-based browser streaming platform on k3s. Three components:

1. **Session Manager** (`session-manager/main.go`) — Go control plane on NodePort 30080. Creates/destroys ephemeral streamer pods, reverse-proxies traffic by session ID, manages port allocation (HostPort range 31000-31099), runs idle GC every 5s.

2. **Streamer Pod** (`server/index.js` + `docker/entrypoint.sh`) — Ephemeral k8s pod per session. Runs Xvfb + PulseAudio + Chrome + OBS Studio + Node.js. OBS captures screen via xshm_input and handles streaming. Proxies Chrome CDP WebSocket on port 9222. OBS WebSocket on port 4455.

3. **Viewer** (`viewer.html`) — Vanilla JS + HLS.js. Session management UI, HLS player, Chrome navigation control. Served by the session manager at `/`.

**Data flow:** Client → Session Manager (creates pod) → `/session/:id/*` reverse proxy → Streamer Pod (Chrome + OBS). Clients can also connect directly via `ws://host:<directPort>` for CDP.

## Build & Deploy

All builds happen remotely via SSH + buildkit (no local Docker needed). Target host defaults to `HOST=5.78.145.53`.

```bash
make build                  # Build both images on remote host
make build-streamer         # Build only streamer image
make build-session-manager  # Build only session-manager image
make deploy                 # Apply k8s manifests + restart session-manager
make restart                # Restart session-manager (uses cached image)
make provision HOST=x.x.x.x [TOKEN=...]  # Full infra from scratch
```

Typical change cycle: `make build deploy`

## Observe & Manage

```bash
make status                     # Pods + services
make logs-sm                    # Tail session-manager logs
make logs-session POD=streamer-abc12345  # Tail a streamer pod
make sessions TOKEN=...         # List sessions via API
make create-session TOKEN=...   # Create a session via API
make clean                      # Delete all session pods
```

## Key Configuration

Session manager env vars (set in `k8s/session-manager-deployment.yaml`):
- `TOKEN` — shared auth token (from k8s secret `browserless-auth`)
- `NAMESPACE` — k8s namespace (default: `browser-streamer`)
- `STREAMER_IMAGE` — pod image (default: `browser-streamer:latest`)
- `MAX_SESSIONS` — concurrent limit (default: 3)
- `IDLE_TIMEOUT` — minutes before GC (default: 10)
- `PORT_RANGE_START/END` — HostPort range (default: 31000-31099)

## Session Manager API

All endpoints except `/health` and `/` require `?token=` or `Authorization: Bearer` header.

- `GET /health` — returns `{"status":"ok"}`, adds session count when authenticated
- `POST /api/session` — creates streamer pod, returns `{id, directPort, status}`
- `GET /api/sessions` — list active sessions
- `DELETE /api/session/:id` — kill session pod
- `/session/:id/hls/*`, `/session/:id/api/*` — reverse proxy to pod
- `ws /session/:id` — WebSocket proxy to pod CDP

## Auth

Single shared token via k8s secret. Session manager uses `crypto/subtle.ConstantTimeCompare`. Token is propagated to streamer pods via secret mount — both layers validate independently.

## Go Development

```bash
cd session-manager
go build -o /dev/null .   # Compile check
go vet ./...              # Lint
```

No test suite yet. The Go module uses k8s.io/client-go v0.29.3 with in-cluster config.

## Pod Template Details

Streamer pods created by the session manager (in `main.go createSession()`):
- Labels: `app=streamer-session`, `session-id=<uuid>`
- `restartPolicy: Never` — failed pod = dead session
- Resources: 1 CPU / 2Gi request, 2 CPU / 6Gi limit
- 2Gi `/dev/shm` emptyDir for Chrome
- Readiness probe: HTTP `/health` on port 8080, 2s initial delay, 2s period
- `imagePullPolicy: Never` (image pre-loaded on node)

## Streamer Internals

The entrypoint starts processes sequentially: Xvfb → PulseAudio → Chrome (with `--user-data-dir=/tmp/chrome-data --remote-debugging-port=9222`) → OBS Studio (with xshm_input screen capture, WebSocket on port 4455) → Node server. OBS handles all screen capture and streaming.
