# Architecture: Streamer (Stage Pod)

**Part:** `streamer/`
**Language:** Node.js / JavaScript
**Last updated:** 2026-03-03

---

## Overview

The streamer runs as an ephemeral Kubernetes pod (one per stage). It provides an isolated browser environment with:
- Google Chrome running on a headless display (Xvfb)
- A **panel system** for managing synced content directories rendered by Chrome
- A Node.js/Express HTTP API for content management, CDP discovery, and health
- OBS Studio for screen capture and optional RTMP streaming
- ffmpeg HLS preview pipeline for low-latency live preview
- WebSocket proxy from the control plane to Chrome's CDP port
- A **sidecar container** (rclone) that syncs content and Chrome state to Cloudflare R2
- An **init container** that restores content and Chrome state from R2 on stage start

---

## Technology Stack

| Category | Technology | Version |
|----------|------------|---------|
| Runtime | Node.js | 24 |
| HTTP Server | Express | 4.18.2 |
| HTTP Proxy | http-proxy | 1.18.1 |
| WebSocket | ws | 8.x |
| Browser | Google Chrome Stable | Latest |
| Virtual Display | Xvfb | System |
| Audio | PulseAudio | System |
| Screen Capture / Streaming | OBS Studio | 28+ (WebSocket v5) |
| Base Image | Ubuntu | 24.04 |

---

## Process Architecture

The streamer pod has three containers:

1. **Init container** (`restore.sh`): Restores `/data/` from R2 (content, Chrome localStorage, IndexedDB)
2. **Main container** (`entrypoint.sh`): Runs all processes sequentially
3. **Sidecar container** (`entrypoint.sh`): Watches `/data/` for changes and syncs to R2

### Main Container Process Startup

```
1. Xvfb :99 (1280x720x24)         → Virtual X11 display
2. PulseAudio (daemon)              → Audio system on /tmp/pulse/native
3. unclutter                        → Hides mouse cursor on display
4. Node.js server (index.js)        → HTTP API on port 8080
5. Google Chrome (kiosk mode)       → CDP on localhost:9222
6. OBS Studio                       → WebSocket on localhost:4455
7. ffmpeg (x11grab → HLS)           → /tmp/hls/stream.m3u8
```

Signal trap `EXIT INT TERM` kills all child processes on exit.

### Graceful Shutdown (preStop hook)

The pod has a `preStop` hook (`prestop.sh`) that:
1. Kills Chrome (so it flushes localStorage/IndexedDB to `/data/chrome/`)
2. Creates `/data/.sync-request` sentinel file
3. Waits up to 25s for the sidecar to create `/data/.sync-done` (final sync complete)

---

## Port Map

| Port | Service | Access |
|------|---------|--------|
| `8080` | Node.js HTTP API | External (via control plane proxy) |
| `9222` | Chrome CDP | Internal only (proxied through Node.js) |
| `4455` | OBS WebSocket v5 | Internal only (used by OBS commands) |

---

## HTTP API Endpoints

### Health
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Returns `{ status: 'ok', lastActivity, uptime }` |

### CDP Discovery (rewrites WS URLs)
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/json` | Token | Chrome tab list (WS URLs rewritten to external host) |
| GET | `/json/version` | Token | Chrome version info |
| GET | `/json/list` | Token | Available tabs |

### Panel System
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/panels` | Token | Create or resize a panel (`{ name, width, height }`) |
| POST | `/api/panels/:name/sync` | Token | Push synced directory content to panel |
| POST | `/api/panels/:name/event` | Token | Emit state event to panel (`{ event, data }`) |
| GET | `/api/panels/:name/screenshot` | Token | Capture screenshot of panel as PNG |

### WebSocket
| Protocol | Path | Auth | Description |
|----------|------|------|-------------|
| WS | `/*` | Token (query param) | CDP WebSocket proxy to Chrome port 9222 |

---

## Panel System

The panel system is the core feature of the streamer. It manages named, isolated browser views:

1. **Panel directory**: Each panel `<name>` gets a directory at `/data/content/<name>/`
2. **User content**: A full directory synced from the CLI, containing an `index.html` entry point and any supporting files (JS, CSS, images, etc.)
3. **Serving**: Chrome loads content directly from the filesystem (`file:///` URLs)
4. **Refresh**: Explicit page reload triggered by `dazzle s refresh` or `dazzle s sync --refresh`
5. **State events**: `emit_event` dispatches a `CustomEvent` on `window` — no page reload
6. **Persistence**: Chrome's localStorage and IndexedDB are persisted to R2 via the sidecar, so app state survives stage restarts

### Content Update Flow

```
CLI sync
         │
         ▼
  Write files to /data/content/<panel>/
         │
         ▼
  CLI sends refresh command (if --refresh flag)
         │
         ▼
  Chrome reloads the entry point from disk
```

---

## OBS Integration

The streamer includes an internal OBS WebSocket v5 client (`OBSConnection` class in `index.js`):
- Connects to `ws://localhost:4455` (no auth) with 30s retry
- Request/response correlation via `requestId`
- Used by MCP `obs` tool for OBS scene/source/streaming control

---

## Authentication

Token-based with constant-time comparison:
- Token loaded from `TOKEN` env var (injected from `browserless-auth` Kubernetes secret)
- Accepted via `Authorization: Bearer <token>` header or `?token=<token>` query param
- If `TOKEN` env is unset, all requests pass through (development mode)

---

## Chrome Configuration

Key startup flags:
- `--no-sandbox` (required in containers)
- `--kiosk` (full-screen, no UI chrome)
- `--remote-debugging-port=9222` + `--remote-debugging-address=0.0.0.0`
- `--disable-background-timer-throttling`
- `--autoplay-policy=no-user-gesture-required`
- `--user-data-dir=/data/chrome` (persisted to R2 via sidecar)
- Display: `:99` (Xvfb)

---

## Resource Allocation

Defined in the control plane pod spec:

| Resource | Request | Limit |
|----------|---------|-------|
| CPU | 2 cores | 4 cores |
| Memory | 4 Gi | 8 Gi |
| `/dev/shm` | — | 2 Gi (memory medium for Chrome) |

---

## Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `8080` | HTTP server listen port |
| `TOKEN` | (none) | Auth token from `browserless-auth` secret |
| `DISPLAY` | `:99` | X11 display (set in Dockerfile) |
| `PULSE_SERVER` | `unix:/tmp/pulse/native` | PulseAudio socket |
| `SCREEN_WIDTH` | `1280` | Xvfb width |
| `SCREEN_HEIGHT` | `720` | Xvfb height |

---

## Docker Image

### Main Image

**Base:** `ubuntu:24.04`

**Layers (approximate):**
1. System deps (X11, audio, fonts, network tools)
2. OBS Studio + ffmpeg (from PPA, WebSocket v5)
3. Google Chrome Stable (from Google .deb)
4. Node.js 24 (from NodeSource)
5. Application code (`index.js`, `package.json`)
6. Startup entrypoint + prestop hook

**Image size:** ~2 GB+ (Chrome + OBS + X11 stack).

### Sidecar Image

**Base:** `rclone/rclone:1.69`

Adds `inotify-tools` and `util-linux` (for `flock`). Contains `entrypoint.sh` (watch + sync loop) and `restore.sh` (init container restore).

---

## Persistence (R2 Sidecar)

The sidecar container syncs the following paths from the shared `/data/` volume to Cloudflare R2:
- `content/**` — panel scripts and synced directories
- `chrome/Default/Local Storage/**` — Chrome localStorage
- `chrome/Default/IndexedDB/**` — Chrome IndexedDB

**R2 path:** `users/<user_id>/stages/<stage_id>/`

**Sync flow:**
1. Init container (`restore.sh`) restores from R2 → `/data/` before the main container starts
2. Sidecar watches `/data/` with `inotifywait` and syncs changes to R2 (debounced, with `flock` to prevent concurrent syncs)
3. On pod shutdown, the prestop hook triggers a final sync via the `.sync-request` → `.sync-done` sentinel protocol
4. On `DeleteStage`, the control plane waits for pod termination, then does best-effort R2 prefix cleanup

**Degradation:** If R2 credentials are not configured, the sidecar idles (no-op) and stages work normally without persistence.

---

## Health & Readiness

- **K8s Readiness Probe:** `GET /health` on port 8080, initial delay 2s, period 2s, failure threshold 30 (60s total window)
- Probe checks Node.js server availability; Chrome CDP readiness is implicit (Chrome starts before Node.js server)
