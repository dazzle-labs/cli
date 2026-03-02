# Architecture: Streamer (Ephemeral Pod)

## Overview

The streamer runs as an ephemeral Kubernetes pod, providing an isolated browser environment with screen capture capabilities. Each pod runs Xvfb (virtual display), PulseAudio (audio), Google Chrome (browser), OBS Studio (screen capture/streaming), and a Node.js API server.

## Technology Stack

| Category | Technology | Version |
|----------|-----------|---------|
| Base Image | Ubuntu | 22.04 |
| Browser | Google Chrome Stable | Latest |
| Screen Capture | OBS Studio | 28+ (with built-in WebSocket) |
| Virtual Display | Xvfb | System |
| Audio | PulseAudio | System |
| Runtime | Node.js | 20 |
| Web Framework | Express | 4.18.2 |
| Proxy | http-proxy | 1.18.1 |
| Cursor | unclutter | System |

## Process Architecture

The entrypoint starts processes sequentially with a cleanup trap:

```
1. Xvfb :99 (1280x720x24)    → Virtual X11 display
2. PulseAudio (daemon)        → Audio system on /tmp/pulse/native
3. unclutter                  → Hides mouse cursor
4. Google Chrome (kiosk)      → Remote debugging on port 9222
5. OBS Studio                 → WebSocket on port 4455
6. Node.js server             → HTTP API on port 8080
```

Signal handling: `trap cleanup EXIT INT TERM` — kills all child processes. `wait -n` exits when any process dies.

## Port Map

| Port | Service | Access |
|------|---------|--------|
| 8080 | Node.js HTTP API | External (k8s service) |
| 9222 | Chrome CDP | Internal (proxied via Node.js) |
| 4455 | OBS WebSocket v5 | Internal (used by MCP tools) |

## API Endpoints

### Health
- `GET /health` — No auth. Returns `{ status: 'ok', lastActivity, uptime }`

### CDP Discovery (auth required)
- `GET /json` — Chrome tab list (rewrites WS URLs to external host)
- `GET /json/version` — Chrome version info
- `GET /json/list` — Available tabs

### Template Engine (auth required)
- `POST /api/template` — Store and render HTML in Chrome (`{ html }`)
- `GET /api/template` — Get current HTML
- `POST /api/template/edit` — Find-and-replace edit (`{ old_string, new_string }`)
- `GET /template` — Serves HTML to Chrome (no auth, localhost only)

### Navigation (auth required)
- `POST /api/navigate` — Navigate Chrome to URL (`{ url }`)

### WebSocket
- `WS /*` — CDP WebSocket proxy to Chrome port 9222 (token in query string)

## Authentication

Token-based with constant-time comparison:
- Accepts `?token=` query param or `Authorization: Bearer` header
- Token loaded from `TOKEN` env var (injected from k8s secret)
- No-auth mode: if `TOKEN` env var is unset, all requests pass through

## Chrome Configuration

Key startup flags:
- `--no-sandbox` (container requirement)
- `--kiosk` (full-screen mode)
- `--remote-debugging-port=9222` (CDP access)
- `--remote-debugging-address=0.0.0.0`
- `--disable-background-timer-throttling` (smooth rendering)
- `--autoplay-policy=no-user-gesture-required`
- `--user-data-dir=/tmp/chrome-data`

Initial page: Data URI with styled "HELLO WORLD" landing.

## OBS Configuration

Pre-baked configuration via entrypoint heredocs:
- **Profile:** Resolution matches Xvfb (1280x720), H.264 encoding, 30 FPS
- **Scene:** xshm screen capture source on display `:99`
- **WebSocket:** Enabled on port 4455, no authentication
- **Mode:** Minimize to tray, disabled shutdown check

## Docker Image

**Base:** `ubuntu:22.04`

**Layers:**
1. System deps (X11, audio, fonts, media tools)
2. OBS Studio (from PPA)
3. Google Chrome Stable (from Google .deb)
4. Node.js 20 (from NodeSource)
5. Application code (`/app/index.js` + `package.json`)
6. Config files (PulseAudio config, entrypoint script)

**Image size considerations:** Large image (~2GB+) due to Chrome + OBS + X11 stack. Pre-loaded on k3s node (imagePullPolicy: Never).

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | 8080 | Node.js server port |
| `TOKEN` | (none) | Auth token from k8s secret |
| `DISPLAY` | :99 | X11 display (set in Dockerfile) |
| `PULSE_SERVER` | unix:/tmp/pulse/native | PulseAudio socket (set in Dockerfile) |
| `SCREEN_WIDTH` | 1280 | Xvfb resolution width |
| `SCREEN_HEIGHT` | 720 | Xvfb resolution height |

## Resource Allocation (from session manager)

- Requests: 2 CPU, 4Gi RAM
- Limits: 4 CPU, 8Gi RAM
- `/dev/shm`: 2Gi (Memory medium, for Chrome shared memory)

## Health & Readiness

- **K8s Readiness Probe:** HTTP GET `/health` on port 8080, initial delay 2s, period 2s, failure threshold 30
- **Internal Checks:** Chrome CDP readiness (12s max), OBS WebSocket readiness (30s max)
