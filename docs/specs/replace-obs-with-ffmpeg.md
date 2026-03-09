# Quick Tech Spec: Replace OBS with Direct ffmpeg Pipeline

## Problem

OBS Studio consumes **141% CPU** just for software-rendered GL compositing (llvmpipe) of a single full-screen source with no overlays, effects, or transitions. Combined with a separate ffmpeg process for HLS preview (~47% CPU), the streamer container is pegged at its 3500m CPU limit. OBS is massively overkill for our use case.

## Solution

Replace OBS with a single ffmpeg process managed by the sidecar. Use Chrome CDP for screenshots.

### CPU Impact

| Component | Current (OBS) | Proposed (ffmpeg) |
|---|---|---|
| Screen capture + compositing | ~141% (llvmpipe GL) | ~5% (x11grab shm read) |
| HLS encode (always-on) | ~45% (OBS recording) | ~45% (ffmpeg x264) |
| RTMP encode (when broadcasting) | ~50% (OBS streaming) | +0% (shares HLS encode via tee) |
| Screenshots | via OBS WebSocket | via CDP (on-demand, ~0%) |
| **Total (idle)** | **~186%** | **~50%** |
| **Total (broadcasting)** | **~236%** | **~55%** |

**~130-180% CPU savings.** Enough headroom for richer content in Chrome.

## Architecture

### Current

```
Xvfb :99
  ├── Chrome (renders content)
  ├── OBS (xshm capture → llvmpipe GL → x264 encode → RTMP + HLS recording)
  └── [removed: ffmpeg x11grab → x264 → HLS]

Sidecar connects to OBS WebSocket :4455 for control + screenshots + stats
gobs-cli shells out for broadcast start/stop/config
```

### Proposed

```
Xvfb :99
  ├── Chrome (renders content)
  └── ffmpeg (x11grab → x264 encode → tee → HLS + optional RTMP)

Sidecar manages ffmpeg process directly (no WebSocket, no gobs-cli)
Sidecar uses CDP for screenshots (already has CDP client)
```

## ffmpeg Pipeline Design

### HLS-only mode (default, always running)

```bash
ffmpeg -f x11grab -video_size 1280x720 -framerate 30 -i :99 \
       -f pulse -i default \
       -c:v libx264 -preset ultrafast -tune zerolatency -g 30 \
       -c:a aac -b:a 96k \
       -vf scale=960:540 \
       -f hls -hls_time 1 -hls_list_size 5 \
       -hls_flags delete_segments+append_list \
       -hls_segment_filename '/tmp/hls/seg%03d.ts' \
       /tmp/hls/stream.m3u8
```

### Broadcast mode (HLS + RTMP, when user starts broadcasting)

```bash
ffmpeg -f x11grab -video_size 1280x720 -framerate 30 -i :99 \
       -f pulse -i default \
       -filter_complex "[0:v]split=2[hls_v][rtmp_v]" \
       -map "[hls_v]" -map 0:a \
         -c:v libx264 -preset ultrafast -tune zerolatency -g 30 \
         -c:a aac -b:a 96k \
         -vf scale=960:540 \
         -f hls -hls_time 1 -hls_list_size 5 \
         -hls_flags delete_segments+append_list \
         -hls_segment_filename '/tmp/hls/seg%03d.ts' \
         /tmp/hls/stream.m3u8 \
       -map "[rtmp_v]" -map 0:a \
         -c:v libx264 -preset veryfast -tune zerolatency \
         -b:v 2500k -maxrate 2500k -bufsize 5000k -g 60 \
         -c:a aac -b:a 128k \
         -f flv "rtmp://ingest.example.com/live/stream_key"
```

### Switching modes

When broadcast starts/stops, the sidecar restarts ffmpeg with the appropriate pipeline. Brief HLS interruption (~1-2s) is acceptable — the web player reconnects automatically.

## Changes by Component

### 1. New: `sidecar/internal/ffmpeg/` package

Replaces `sidecar/internal/obs/`. Manages the ffmpeg process lifecycle.

```go
type Pipeline struct {
    cmd        *exec.Cmd
    mu         sync.Mutex
    hlsDir     string
    screenSize string  // "1280x720"
    display    string  // ":99"

    // Broadcast state
    broadcasting bool
    rtmpURL      string
    streamKey    string

    // Stats (parsed from ffmpeg progress output)
    fps           float64
    droppedFrames int64
    totalBytes    int64
    statsCallback func(stats Stats)
}

func (p *Pipeline) Start() error           // Start HLS-only mode
func (p *Pipeline) StartBroadcast(rtmpURL, streamKey string) error  // Restart with RTMP
func (p *Pipeline) StopBroadcast() error   // Restart HLS-only
func (p *Pipeline) Stop() error            // Kill ffmpeg
func (p *Pipeline) Stats() Stats           // Current stats
func (p *Pipeline) IsBroadcasting() bool
```

**Stats parsing**: ffmpeg's `-progress pipe:1` flag outputs key=value stats to stdout every second. Parse `fps=`, `drop_frames=`, `total_size=`, `speed=` for Prometheus metrics.

### 2. Update: `sidecar/internal/server/rpc_obs.go`

Replace gobs-cli shell-out with direct ffmpeg pipeline control.

**New RPC implementations:**

| gobs-cli command | New implementation |
|---|---|
| `st s` (start stream) | `pipeline.StartBroadcast(url, key)` |
| `st st` (stop stream) | `pipeline.StopBroadcast()` |
| `st ss` (stream status) | `pipeline.IsBroadcasting()` + stats |
| `settings stream-service ...` | Store RTMP config in sidecar state |
| `sc ls` (list scenes) | Return static "Scene" (single scene) |
| Other scene/source commands | Return "not supported" or static responses |

Keep the `ObsService` proto interface for backward compat — the sidecar just implements it differently internally. CLI and control-plane don't need to change their RPC calls.

### 3. Update: `sidecar/internal/server/server.go`

Replace `connectOBS()` with ffmpeg pipeline startup:

```go
func (s *Server) startPipeline() {
    s.pipeline = ffmpeg.NewPipeline(s.cfg.HLSDir, s.cfg.ScreenSize(), s.cfg.Display)
    s.pipeline.SetStatsCallback(updateFFmpegMetrics)
    if err := s.pipeline.Start(); err != nil {
        log.Printf("FATAL: ffmpeg pipeline failed to start: %v", err)
    }
    log.Println("ffmpeg HLS pipeline started")
}
```

### 4. Update: `sidecar/internal/server/metrics.go`

Rename metrics but keep Prometheus gauge structure:

| Current metric | New metric |
|---|---|
| `obs_cpu_usage` | Remove (not needed, ffmpeg is lightweight) |
| `obs_memory_usage_bytes` | Remove |
| `obs_active_fps` | `pipeline_fps` |
| `obs_render_skipped_frames_total` | `pipeline_dropped_frames_total` |
| `obs_output_skipped_frames_total` | (merged into above) |
| `obs_output_active` | `pipeline_broadcasting` |
| `obs_output_bytes_total` | `pipeline_output_bytes_total` |

### 5. Update: Screenshot path

Currently in `rpc_runtime.go`, screenshot calls `s.obsClient.Screenshot()`.

Replace with CDP screenshot:

```go
func (s *runtimeServer) Screenshot(ctx context.Context, req ...) {
    // Use CDP Page.captureScreenshot instead of OBS
    imgData, err := s.s.cdpClient.Screenshot()
    // ... same response format (base64 PNG)
}
```

Add `Screenshot()` method to the existing `cdp.Client` — just send `Page.captureScreenshot` via the CDP WebSocket that's already connected.

### 6. Update: `streamer/docker/Dockerfile`

Remove OBS and related dependencies:

```diff
- RUN add-apt-repository ppa:obsproject/obs-studio \
-     && apt-get update \
-     && apt-get install -y obs-studio ffmpeg \
-     && rm -rf /var/lib/apt/lists/*
+ RUN apt-get update \
+     && apt-get install -y ffmpeg \
+     && rm -rf /var/lib/apt/lists/*
```

Also remove: `dbus`, `xdotool`, Mesa GL overrides, `python3-cryptography` workaround.

**Image size reduction**: ~200-300MB smaller.

### 7. Update: `streamer/docker/entrypoint.sh`

Dramatically simplified — remove all OBS config/startup:

```bash
#!/usr/bin/env bash
set -euo pipefail

cleanup() {
    kill "$CHROME_PID" 2>/dev/null || true
    kill "$PULSE_PID" 2>/dev/null || true
    kill "$XVFB_PID" 2>/dev/null || true
    wait
}
trap cleanup EXIT INT TERM

SCREEN_WIDTH="${SCREEN_WIDTH:-1280}"
SCREEN_HEIGHT="${SCREEN_HEIGHT:-720}"

# 1. Start Xvfb
Xvfb :99 -screen 0 ${SCREEN_WIDTH}x${SCREEN_HEIGHT}x24 -ac +extension GLX +render -noreset &
XVFB_PID=$!

# 2. PulseAudio
mkdir -p /tmp/pulse
pulseaudio --daemonize --no-cpu-limit --system=false \
    --exit-idle-time=-1 \
    --load="module-native-protocol-unix auth-anonymous=1 socket=/tmp/pulse/native"
PULSE_PID=$(pgrep -f pulseaudio || true)

sleep 0.3
unclutter -idle 0 -root & disown

# 3. Wait for sidecar
for i in $(seq 1 120); do
    curl -s http://localhost:8080/_dz_9f7a3b1c/health > /dev/null 2>&1 && break
    sleep 0.5
done

# 4. Chrome
google-chrome-stable \
    --no-sandbox --disable-gpu --disable-dev-shm-usage \
    --no-first-run --no-default-browser-check --disable-infobars \
    --autoplay-policy=no-user-gesture-required \
    --remote-debugging-port=9222 --remote-debugging-address=0.0.0.0 \
    --user-data-dir=/data/chrome --kiosk \
    --window-size=${SCREEN_WIDTH},${SCREEN_HEIGHT} --window-position=0,0 \
    --display=:99 \
    --disable-background-timer-throttling \
    --disable-backgrounding-occluded-windows \
    --disable-renderer-backgrounding \
    "http://localhost:8080/" &
CHROME_PID=$!

# 5. HLS + RTMP handled by sidecar (manages ffmpeg process directly)
mkdir -p /tmp/hls

echo "All processes started. Waiting..."
wait -n
```

Removed: dbus-launch, OBS config generation (global.ini, basic.ini, streamEncoder.json, scenes JSON), OBS startup, OBS window management (xdotool), OBS WebSocket wait loop.

### 8. Update: `sidecar/Dockerfile`

Remove gobs-cli installation:

```diff
- RUN go install github.com/andreykaipov/goobs/cmd/gobs-cli@v0.18.2
```

### 9. Control-plane changes

**`mcp.go`**: `configureOBSStream()` currently shells out gobs-cli to set RTMP URL on OBS. Replace with a new sidecar RPC:

```proto
// Add to ObsService (or rename to StreamService)
rpc ConfigureStream(ConfigureStreamRequest) returns (ConfigureStreamResponse);

message ConfigureStreamRequest {
  string rtmp_url = 1;
  string stream_key = 2;
}
```

The sidecar stores the RTMP config and uses it when `StartBroadcast` is called. This replaces the multi-step gobs-cli dance.

**Alternative (simpler)**: Keep the existing `ObsCommand` RPC but have the sidecar interpret `["settings", "stream-service", ...]` args itself instead of shelling to gobs-cli. This minimizes proto changes.

### 10. CLI changes

**None required for broadcast commands** — `dazzle s bc on/off/status` already goes through the control-plane, which talks to sidecar RPC. The sidecar implementation changes but the interface stays the same.

**`dazzle obs`**: Keep working by having the sidecar interpret common gobs-cli command patterns. For unrecognized commands, return "not supported — OBS has been replaced with a direct ffmpeg pipeline."

## Migration Strategy

### Phase 1: Ship current OBS recording change (already done)
- OBS writes HLS directly, removes separate ffmpeg
- Gets some relief while we build the replacement

### Phase 2: Add CDP screenshot + ffmpeg pipeline to sidecar
- New `sidecar/internal/ffmpeg/` package
- New `cdpClient.Screenshot()` method
- Test locally with `make dev`

### Phase 3: Replace OBS in streamer container
- Update Dockerfile (remove OBS)
- Simplify entrypoint.sh
- Update sidecar RPC handlers
- Remove gobs-cli from sidecar Dockerfile

### Phase 4: Clean up
- Remove `sidecar/internal/obs/` package
- Update metrics names
- Update docs
- Rename metrics in Grafana/alerts if applicable

## Risks

1. **ffmpeg process management complexity**: Need robust restart logic, graceful RTMP disconnect, HLS continuity. Mitigated by keeping the sidecar's process management simple (kill + restart).

2. **Brief HLS interruption on broadcast toggle**: ~1-2 seconds while ffmpeg restarts. The web player's HLS.js handles this gracefully (retries on segment fetch failure).

3. **gobs-cli command compatibility**: Advanced users using `dazzle obs` with arbitrary commands will lose access. Mitigated by keeping common patterns working and documenting the change.

4. **Two x264 encodes in broadcast mode**: HLS preview (960x540 ultrafast) + RTMP broadcast (1280x720 veryfast) are separate encodes. Total ~85% CPU in broadcast mode vs ~55% idle. Still far better than OBS's ~236% in broadcast mode.

## Out of Scope

- GPU acceleration (no GPU on Hetzner nodes)
- Multiple scenes/sources (single full-screen Chrome capture is the only use case)
- Recording to file (only HLS preview + RTMP streaming)
- Audio mixing beyond Chrome + PulseAudio default sink
