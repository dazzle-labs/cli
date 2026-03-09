# Architecture: Streamer (Stage Pod)

**Part:** `streamer/` (infrastructure), `sidecar/` (application logic)
**Language:** Bash (streamer), Go (sidecar)
**Last updated:** 2026-03-09

---

## Overview

The streamer runs as an ephemeral Kubernetes pod (one per stage). It provides an isolated browser environment with:
- Google Chrome running on a headless display (Xvfb)
- A direct **ffmpeg pipeline** (managed by the sidecar) for HLS preview and optional RTMP broadcast
- A **Go sidecar** that handles all application logic: content sync API, CDP client for log capture/event dispatch/screenshots, ffmpeg pipeline management, R2 persistence, Prometheus metrics, and static content serving
- An **init container** (`sidecar restore`) that restores content and Chrome state from R2 on stage start

The streamer container is pure infrastructure — Xvfb, Chrome, and PulseAudio only. No OBS, no application code. All application logic lives in the sidecar.

---

## Technology Stack

| Category | Technology | Version |
|----------|------------|---------|
| Sidecar | Go binary | — |
| Content Sync API | ConnectRPC (SyncService) | — |
| CDP Client | Go CDP library | — |
| Screen Capture / Streaming | ffmpeg (x11grab + pulse) | System |
| R2 Client | minio-go | — |
| Browser | Google Chrome Stable | Latest |
| Virtual Display | Xvfb | System |
| Audio | PulseAudio | System |
| Base Image | Ubuntu | 24.04 |

---

## Process Architecture

The streamer pod has three containers:

1. **Init container** (`sidecar restore`): Restores content and Chrome state from R2 before the main containers start
2. **Streamer container** (`entrypoint.sh`): Pure infrastructure — runs Xvfb, PulseAudio, Chrome
3. **Sidecar container** (Go binary): All application logic — content sync API, CDP client, ffmpeg pipeline, R2 persistence, static content serving

### Streamer Container Process Startup

```
1. Xvfb :99 (1280x720x24)         → Virtual X11 display
2. PulseAudio (daemon)              → Audio system on /tmp/pulse/native
3. unclutter                        → Hides mouse cursor on display
4. Wait for sidecar health          → GET /_dz_9f7a3b1c/health on port 8080
5. Google Chrome (kiosk mode)       → Navigates to http://localhost:8080/, CDP on localhost:9222
```

The sidecar starts the ffmpeg pipeline after Chrome CDP is connected. ffmpeg captures Xvfb via x11grab and PulseAudio for audio.

Signal trap `EXIT INT TERM` kills all child processes on exit.

### Graceful Shutdown (preStop hook)

The streamer pod has a `preStop` hook that kills Chrome so it flushes localStorage/IndexedDB to disk. The sidecar handles final R2 sync on its own shutdown.

---

## Port Map

| Port | Service | Access |
|------|---------|--------|
| `8080` | Sidecar HTTP (ConnectRPC + static content) | External (via control plane proxy) |
| `9222` | Chrome CDP | Internal only |

---

## Sidecar HTTP API

The sidecar serves on port 8080 with two URL spaces:

### Public (content serving)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Static content serving (synced user content with `index.html` entry point) |

### Internal APIs (`/_dz_9f7a3b1c/` prefix)
| Method | Path | Description |
|--------|------|-------------|
| GET | `/_dz_9f7a3b1c/health` | Health/readiness check |
| — | `/_dz_9f7a3b1c/` | ConnectRPC SyncService (content sync from CLI) |
| — | `/_dz_9f7a3b1c/` | CDP log capture, event dispatch, navigation |
| — | `/_dz_9f7a3b1c/` | Broadcast control (ffmpeg pipeline) |
| — | `/_dz_9f7a3b1c/` | Prometheus metrics |

---

## Content Sync

Content is synced from the CLI via ConnectRPC SyncService on the sidecar:

1. **Sync API**: The CLI pushes directory content via `dazzle s sync <dir>` to the sidecar's ConnectRPC endpoint
2. **Static serving**: The sidecar serves synced content at `/` over HTTP on port 8080
3. **Chrome loads via HTTP**: Chrome navigates to `http://localhost:8080/` — content is served by the sidecar, not from the filesystem
4. **Refresh**: The browser automatically reloads after every successful sync; `dazzle s refresh` is available for manual reloads without re-syncing
5. **State events**: Event dispatch via CDP — no page reload
6. **Persistence**: Chrome's localStorage and IndexedDB are persisted to R2 via the sidecar, so app state survives stage restarts

### Content Update Flow

```
CLI sync (ConnectRPC)
         │
         ▼
  Sidecar writes files to stage-data volume
         │
         ▼
  Sidecar serves updated content at / on port 8080
         │
         ▼
  Sidecar auto-refreshes browser via CDP
```

---

## Streaming Pipeline

The sidecar manages ffmpeg directly for screen capture and streaming — no OBS. The pipeline captures Xvfb via x11grab and PulseAudio audio:

- **HLS preview** (always-on): 960x540, 1500kbps, x264 ultrafast preset → `/tmp/hls/stream.m3u8`
- **RTMP broadcast** (on-demand): full resolution, 2500kbps, x264 veryfast preset → configured RTMP destination

The pipeline auto-restarts on unexpected exit and provides stats (FPS, dropped frames, speed) via the metrics endpoint. Screenshots are captured via Chrome CDP (`Page.captureScreenshot`).

---

## Authentication

Token-based authentication is handled by the sidecar:
- Token loaded from `TOKEN` env var (injected from Kubernetes secret)
- The streamer container has no token — it is pure infrastructure

---

## Chrome Configuration

Key startup flags:
- `--no-sandbox` (required in containers)
- `--kiosk` (full-screen, no UI chrome)
- `--remote-debugging-port=9222` + `--remote-debugging-address=0.0.0.0`
- `--disable-background-timer-throttling`
- `--autoplay-policy=no-user-gesture-required`
- `--user-data-dir=/data/chrome` (persisted to R2 via sidecar)
- Initial URL: `http://localhost:8080/`
- Display: `:99` (Xvfb)

---

## Resource Allocation

Defined in the control plane pod spec:

### Streamer Container
| Resource | Request | Limit |
|----------|---------|-------|
| CPU | 500m | 3500m |
| Memory | 2 Gi | 14 Gi |

### Sidecar Container
| Resource | Request | Limit |
|----------|---------|-------|
| CPU | 100m | 500m |
| Memory | 128 Mi | 512 Mi |

### Init Container
| Resource | Request | Limit |
|----------|---------|-------|
| CPU | 100m | 500m |
| Memory | 64 Mi | 256 Mi |

### Shared Volumes
| Volume | Size | Type | Purpose |
|--------|------|------|---------|
| `stage-data` | 2 Gi | emptyDir | Shared content between streamer and sidecar |
| `dshm` | 2 Gi | memory | `/dev/shm` for Chrome |
| `hls-data` | 512 Mi | emptyDir | Streamer writes HLS, sidecar serves read-only |

---

## Environment Variables

### Streamer Container
| Variable | Default | Purpose |
|----------|---------|---------|
| `STAGE_ID` | (required) | Stage identifier |
| `USER_ID` | (required) | User identifier |
| `SCREEN_WIDTH` | `1280` | Xvfb width |
| `SCREEN_HEIGHT` | `720` | Xvfb height |
| `DISPLAY` | `:99` | X11 display |
| `PULSE_SERVER` | `unix:/tmp/pulse/native` | PulseAudio socket |

### Sidecar Container
| Variable | Default | Purpose |
|----------|---------|---------|
| `TOKEN` | (required) | Auth token from Kubernetes secret |
| `STAGE_ID` | (required) | Stage identifier |
| `USER_ID` | (required) | User identifier |
| `R2_ENDPOINT` | (required) | Cloudflare R2 endpoint URL |
| `R2_ACCESS_KEY_ID` | (required) | R2 access key |
| `R2_SECRET_ACCESS_KEY` | (required) | R2 secret key |
| `R2_BUCKET` | (required) | R2 bucket name |

---

## Docker Image

### Streamer Image

**Base:** `ubuntu:24.04`

**Layers (approximate):**
1. System deps (X11, audio, fonts, ffmpeg, network tools)
2. Google Chrome Stable (from Google .deb)
3. Startup entrypoint + prestop hook

No Node.js, no npm, no OBS, no application code. **Image size:** ~1.5 GB (Chrome + X11 stack).

### Sidecar Image

Go binary built from `sidecar/`. Contains all application logic: ConnectRPC server, CDP client (screenshots, logs, events), ffmpeg pipeline management (HLS + RTMP), R2 persistence (minio-go), Prometheus metrics, static content serving.

---

## Persistence (R2 via Sidecar)

The sidecar syncs the following paths from the shared `stage-data` volume to Cloudflare R2 via minio-go:
- `content/**` — synced user content directories
- `chrome/Default/Local Storage/**` — Chrome localStorage
- `chrome/Default/IndexedDB/**` — Chrome IndexedDB

**R2 path:** `users/<user_id>/stages/<stage_id>/`

**Sync flow:**
1. Init container (`sidecar restore`) restores from R2 before main containers start
2. Sidecar syncs content changes to R2 as they occur
3. On pod shutdown, the sidecar performs a final R2 sync
4. On `DeleteStage`, the control plane waits for pod termination, then does best-effort R2 prefix cleanup

**Degradation:** If R2 credentials are not configured, the sidecar skips persistence and stages work normally without it.

---

## Health & Readiness

- **K8s Readiness Probe:** `GET /_dz_9f7a3b1c/health` on port 8080 (sidecar), initial delay 2s, period 2s, failure threshold 30 (60s total window)
- Streamer waits for sidecar health (`/_dz_9f7a3b1c/health`) before launching Chrome
