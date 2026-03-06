# Chrome Sandbox Streaming: Comprehensive Research

> **Goal**: Render a React app inside a Chrome sandbox and stream its visual output as live video to Twitch, YouTube, and a custom player.

---

## Table of Contents

1. [Chrome Headless + Streaming](#1-chrome-headless--streaming)
2. [FFmpeg Pipelines](#2-ffmpeg-pipelines)
3. [Puppeteer/Playwright Streaming](#3-puppeteerplaywright-streaming)
4. [Remotion's Rendering Pipeline](#4-remotions-rendering-pipeline)
5. [OBS + Browser Source](#5-obs--browser-source)
6. [Existing Open Source Projects](#6-existing-open-source-projects)
7. [Scaling](#7-scaling)
8. [Audio](#8-audio)
9. [Latency](#9-latency)
10. [Cost Estimation](#10-cost-estimation)
11. [Recommended Architecture](#11-recommended-architecture)

---

## 1. Chrome Headless + Streaming

There are four primary methods for capturing Chrome's rendered output as a video stream.

### 1a. Chrome DevTools Protocol (CDP) Screencast

The CDP `Page.startScreencast` method is the most direct API for capturing Chrome's rendered output.

```js
// CDP Page.startScreencast parameters
await cdpSession.send('Page.startScreencast', {
  format: 'jpeg',       // 'jpeg' or 'png'
  quality: 80,           // 0-100, JPEG only
  maxWidth: 1920,
  maxHeight: 1080,
  everyNthFrame: 1       // capture every Nth frame
});

// Listen for frames
cdpSession.on('Page.screencastFrame', async (event) => {
  const { data, metadata, sessionId } = event;
  // data = base64-encoded image
  // metadata = { offsetTop, pageScaleFactor, deviceWidth, deviceHeight, scrollOffsetX, scrollOffsetY, timestamp }
  await cdpSession.send('Page.screencastFrameAck', { sessionId });
});
```

**Characteristics:**
- Frame rate: Variable, driven by Chrome's compositor. Typically 5-15 fps for screencast, not a steady 30/60 fps.
- Format: Individual JPEG or PNG frames, base64-encoded.
- Latency per frame: ~10-50ms for JPEG encoding at 1080p.
- Key limitation: **Not designed for real-time video streaming.** Frame delivery is best-effort, not clock-driven. No audio capture. You must acknowledge each frame before the next one arrives.
- Best for: Thumbnails, preview streams, low-fps monitoring.

**Verdict:** Insufficient for live video. Frame rate is too low and inconsistent for a production stream.

### 1b. Xvfb (Virtual Framebuffer) + Screen Capture

Run Chrome (headful mode) inside a virtual X11 framebuffer and capture the framebuffer directly.

```bash
# Start Xvfb with a 1920x1080 display at 24-bit color
Xvfb :99 -screen 0 1920x1080x24 -ac &
export DISPLAY=:99

# Launch Chrome
google-chrome --no-sandbox --disable-gpu \
  --window-size=1920,1080 \
  --start-fullscreen \
  http://localhost:3000 &

# Capture the X11 display with FFmpeg
ffmpeg -f x11grab -video_size 1920x1080 -framerate 30 -i :99 \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -f flv rtmp://live.twitch.tv/app/YOUR_STREAM_KEY
```

**Characteristics:**
- Frame rate: Rock-solid 30 or 60 fps (FFmpeg drives the capture clock).
- Quality: Pixel-perfect capture of the full framebuffer.
- Latency: Very low (sub-frame). The framebuffer is just shared memory.
- CPU cost: FFmpeg x264 encoding is the bottleneck, not the capture.
- Audio: Can pair with PulseAudio virtual sink (see Audio section).
- Platform: Linux only (X11). This is the industry-standard approach.

**Verdict: This is the recommended approach for production live streaming.** It is how virtually every headless-browser-to-video project works.

### 1c. WebRTC from Headless Chrome

Chrome can produce a WebRTC stream via `navigator.mediaDevices.getDisplayMedia()` or `canvas.captureStream()`. In headless mode, you'd inject JavaScript that captures a `<canvas>` or the entire tab via the MediaStream API, then send it via WebRTC to a media server.

```js
// Inside the page (injected script)
const stream = document.querySelector('canvas').captureStream(30);
const pc = new RTCPeerConnection({ iceServers: [...] });
stream.getTracks().forEach(track => pc.addTrack(track, stream));
// Signal to a WebRTC server (e.g., Janus, Pion, mediasoup)
```

**Characteristics:**
- Frame rate: 30 fps from `captureStream(30)`.
- Encoding: Chrome uses VP8/VP9/H.264 hardware or software encoding internally.
- Complexity: Requires a full WebRTC signaling + media server pipeline.
- Latency: Sub-second (WebRTC is optimized for real-time).
- Conversion to RTMP: Needs a media server that bridges WebRTC to RTMP (e.g., Janus with streaming plugin, or restream via FFmpeg).

**Verdict:** Viable but over-engineered for this use case. Adds significant complexity (signaling, STUN/TURN, media server) for marginal latency gains. The Xvfb approach is simpler and equally effective.

### 1d. Chrome `--headless=new` with GPU and Virtual Display

Chrome's new headless mode (`--headless=new`, available since Chrome 112) runs the full browser with a compositor but without a visible window. It still requires a display server on Linux for GPU compositing.

```bash
# New headless mode with GPU
google-chrome --headless=new --disable-gpu \
  --remote-debugging-port=9222 \
  --window-size=1920,1080 \
  http://localhost:3000
```

With `--headless=new`, Chrome renders identically to headed mode. You still use Xvfb + FFmpeg x11grab to capture the output. The new headless mode is preferable because it uses the same rendering pipeline as the full browser (no rendering differences).

---

## 2. FFmpeg Pipelines

### Basic Xvfb Capture to RTMP

```bash
ffmpeg \
  -f x11grab -video_size 1920x1080 -framerate 30 -i :99 \
  -f pulse -i default \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -b:v 3000k -maxrate 3000k -bufsize 6000k \
  -pix_fmt yuv420p \
  -g 60 -keyint_min 60 \
  -c:a aac -b:a 128k -ar 44100 \
  -f flv rtmp://live.twitch.tv/app/YOUR_STREAM_KEY
```

### Multi-Output (Twitch + YouTube + Custom)

```bash
ffmpeg \
  -f x11grab -video_size 1920x1080 -framerate 30 -i :99 \
  -f pulse -i default \
  -filter_complex "[0:v]split=3[v1][v2][v3]; [0:a]asplit=3[a1][a2][a3]" \
  -map "[v1]" -map "[a1]" -c:v libx264 -preset ultrafast -tune zerolatency \
    -b:v 3000k -c:a aac -b:a 128k -f flv rtmp://live.twitch.tv/app/TWITCH_KEY \
  -map "[v2]" -map "[a2]" -c:v libx264 -preset ultrafast -tune zerolatency \
    -b:v 4500k -c:a aac -b:a 128k -f flv rtmp://a.rtmp.youtube.com/live2/YT_KEY \
  -map "[v3]" -map "[a3]" -c:v libx264 -preset ultrafast -tune zerolatency \
    -b:v 3000k -c:a aac -b:a 128k -f flv rtmp://your-custom-server/live/CUSTOM_KEY
```

**Note:** Multi-output means encoding the video N times (once per output), which multiplies CPU usage. A better approach for multiple outputs is to encode once and use a restreaming service or relay:

```bash
# Encode once, send to a local nginx-rtmp relay
ffmpeg \
  -f x11grab -video_size 1920x1080 -framerate 30 -i :99 \
  -f pulse -i default \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -b:v 4500k -c:a aac -b:a 128k \
  -f flv rtmp://localhost/relay/stream

# nginx-rtmp pushes to multiple destinations
# (configured in nginx.conf)
```

### FFmpeg Preset Comparison

| Preset | CPU Usage (1080p30) | Latency Added | Quality |
|--------|-------------------|---------------|---------|
| `ultrafast` | ~0.3-0.5 CPU cores | ~1 frame | Acceptable |
| `superfast` | ~0.5-0.8 CPU cores | ~2 frames | Good |
| `veryfast` | ~0.8-1.2 CPU cores | ~3 frames | Very good |
| `medium` | ~2-3 CPU cores | ~5-10 frames | Excellent |

For live streaming, **always use `ultrafast` or `superfast`** with `-tune zerolatency`.

### Hardware Encoding (NVENC)

If the machine has an NVIDIA GPU:

```bash
ffmpeg \
  -f x11grab -video_size 1920x1080 -framerate 30 -i :99 \
  -c:v h264_nvenc -preset llhq -zerolatency 1 \
  -b:v 4500k -maxrate 4500k -bufsize 9000k \
  -f flv rtmp://live.twitch.tv/app/YOUR_KEY
```

NVENC uses ~0% CPU for encoding, offloading entirely to the GPU. One consumer NVIDIA GPU can handle 3-5 simultaneous NVENC encode sessions (limited by NVIDIA's driver caps on consumer cards; professional cards like T4/A10 can handle more).

### Piping CDP Screenshots to FFmpeg (Alternative)

```bash
# Node script pipes raw frames to stdout
node capture.js | ffmpeg \
  -f image2pipe -framerate 30 -i - \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -f flv rtmp://live.twitch.tv/app/KEY
```

Where `capture.js` uses CDP or Puppeteer to capture screenshots in a loop. This works but is limited to ~10-15 fps because each screenshot is a full page render + JPEG encode + base64 decode cycle.

---

## 3. Puppeteer/Playwright Streaming

### Puppeteer CDP Screencast

```js
const puppeteer = require('puppeteer');

const browser = await puppeteer.launch({
  headless: false,  // Use headed mode in Xvfb
  args: ['--no-sandbox', '--window-size=1920,1080']
});

const page = await browser.newPage();
await page.setViewport({ width: 1920, height: 1080 });
await page.goto('http://localhost:3000');

// Access CDP session
const cdpSession = await page.target().createCDPSession();
await cdpSession.send('Page.startScreencast', {
  format: 'jpeg',
  quality: 80,
  maxWidth: 1920,
  maxHeight: 1080,
  everyNthFrame: 1
});

cdpSession.on('Page.screencastFrame', async ({ data, sessionId }) => {
  const buffer = Buffer.from(data, 'base64');
  // Write to FFmpeg stdin or process frame
  ffmpegProcess.stdin.write(buffer);
  await cdpSession.send('Page.screencastFrameAck', { sessionId });
});
```

**Frame Rate Reality:**
- CDP screencast: 5-15 fps (variable, compositor-driven)
- `page.screenshot()` in a loop: 3-10 fps (each is a full render)
- Xvfb + FFmpeg x11grab with headed Puppeteer: 30-60 fps (recommended)

### Playwright Equivalent

```js
const { chromium } = require('playwright');

const browser = await chromium.launch({
  headless: false,
  args: ['--no-sandbox', '--window-size=1920,1080']
});

const page = await browser.newPage();
await page.setViewportSize({ width: 1920, height: 1080 });
await page.goto('http://localhost:3000');

// Playwright also exposes CDP sessions
const cdpSession = await page.context().newCDPSession(page);
// Same CDP screencast API as Puppeteer
```

### Puppeteer Screenshot Stream (Low FPS Approach)

```js
const { spawn } = require('child_process');

const ffmpeg = spawn('ffmpeg', [
  '-f', 'image2pipe',
  '-framerate', '15',
  '-i', '-',
  '-c:v', 'libx264',
  '-preset', 'ultrafast',
  '-tune', 'zerolatency',
  '-pix_fmt', 'yuv420p',
  '-f', 'flv',
  'rtmp://live.twitch.tv/app/KEY'
]);

async function captureLoop() {
  while (true) {
    const screenshot = await page.screenshot({
      type: 'jpeg',
      quality: 80
    });
    ffmpeg.stdin.write(screenshot);
    // Target ~15fps
    await new Promise(r => setTimeout(r, 66));
  }
}
```

**Audio via Puppeteer/Playwright:**
Neither Puppeteer nor Playwright has a native audio capture API. You cannot directly extract audio from the page via these tools. For audio, you must use one of:
- PulseAudio virtual sink (capture Chrome's audio output at the OS level)
- Web Audio API `AudioWorklet` + WebSocket to stream PCM data out
- `chrome.tabCapture` (extension API, not available in headless)

**Verdict:** Use Puppeteer/Playwright to **manage** the browser (launch, navigate, inject content) but **not** to capture the video. Capture via Xvfb + FFmpeg.

---

## 4. Remotion's Rendering Pipeline

### How Remotion Works

Remotion is a React framework for creating videos programmatically. Its rendering pipeline:

1. **Composition**: Define video as React components with frame-based props.
2. **Rendering**: Opens a headless Chrome via Puppeteer, navigates to each frame, takes a screenshot.
3. **Encoding**: Pipes all screenshots through FFmpeg to produce a video file.

```
React Component -> Puppeteer (Chrome) -> Screenshot per frame -> FFmpeg -> MP4/WebM
```

### Remotion's `renderMedia()` / `renderFrames()`

```js
import { renderMedia } from '@remotion/renderer';

await renderMedia({
  composition,
  serveUrl: bundleLocation,
  codec: 'h264',
  outputLocation: 'out/video.mp4',
  // Concurrency: render multiple frames in parallel
  concurrency: 4,  // 4 Chrome tabs rendering different frames simultaneously
});
```

### Can Remotion Do Real-Time/Streaming?

**No, not natively.** Remotion is designed for **offline rendering**:
- It renders frame-by-frame, not in real-time.
- A 30-second video at 30fps = 900 individual screenshot + encode operations.
- Rendering speed: Typically 0.5x to 2x real-time depending on complexity and concurrency.
- There is no built-in RTMP output or live streaming mode.

**Remotion Lambda** renders in the cloud by distributing frames across many Lambda functions, but this is for batch rendering, not live streaming.

### Could You Adapt Remotion for Streaming?

Theoretically, you could:
1. Use Remotion's `<Player>` component (the in-browser preview) to render in real-time in a Chrome instance.
2. Capture that Chrome instance via Xvfb + FFmpeg.

This is essentially **using React in a browser + streaming the browser**, which is exactly our target architecture. You do not need Remotion for this -- just run your React app in Chrome and stream the Chrome output. Remotion adds overhead without benefit for live streaming.

**Verdict:** Remotion is the wrong tool for live streaming. It is optimized for offline video generation. For live streaming a React app, render the React app in Chrome and capture Chrome directly.

---

## 5. OBS + Browser Source

### OBS Studio as a Streaming Pipeline

OBS (Open Broadcaster Software) is the most battle-tested RTMP streaming tool. It natively supports:
- Browser source (embedded Chromium via CEF)
- RTMP output to Twitch, YouTube, any custom server
- Hardware encoding (NVENC, QSV, AMF)
- Audio mixing
- Scene composition

### Headless OBS (`obs-headless` / `obs-cli`)

OBS can run without a GUI using `obs-websocket` for remote control:

```bash
# Run OBS headless (Linux)
obs --minimize-to-tray --startstreaming \
  --scene "BrowserScene" \
  --profile "StreamProfile"
```

Or use the WebSocket API:

```js
const OBSWebSocket = require('obs-websocket-js').default;
const obs = new OBSWebSocket();

await obs.connect('ws://localhost:4455', 'password');
await obs.call('SetCurrentProgramScene', { sceneName: 'BrowserScene' });
await obs.call('StartStream');
```

### OBS Browser Source

OBS uses the Chromium Embedded Framework (CEF) to render web pages as sources:

```json
{
  "source_type": "browser_source",
  "settings": {
    "url": "http://localhost:3000",
    "width": 1920,
    "height": 1080,
    "fps": 30,
    "css": "",
    "shutdown": false,
    "restart_when_active": false
  }
}
```

### Pros of OBS Approach

- Rock-solid RTMP output (years of production use).
- Built-in audio mixing (multiple sources, filters, ducking).
- Hardware encoding support out of the box.
- Multi-output plugin can stream to multiple services simultaneously.
- Scene transitions, overlays, composition.
- `obs-websocket` allows full programmatic control.

### Cons of OBS Approach

- OBS's CEF browser is a stripped-down Chromium -- might not support all modern web APIs.
- Harder to control the embedded browser programmatically (no Puppeteer/CDP access to the CEF browser).
- OBS is a desktop application; running it headless on a server requires Xvfb anyway.
- Heavier resource footprint than a lean Xvfb + Chrome + FFmpeg pipeline.
- Scaling is awkward: each "stream" needs its own OBS process.
- Configuration is file-based (scene collections, profiles), less flexible for dynamic stream management.

### Hybrid Approach

Use Chrome (full, controlled via Puppeteer) for rendering + OBS for encoding/streaming:

```
Chrome (Puppeteer-controlled) -> renders to Xvfb display :99
OBS (headless) -> uses "Screen Capture (XSHM)" source on display :99
OBS -> RTMP output to Twitch/YouTube/Custom
```

This gives you Puppeteer control over the page AND OBS's excellent streaming capabilities. However, it is more complex to set up and manage than Chrome + FFmpeg alone.

**Verdict:** OBS is viable but overkill for this use case unless you need advanced scene composition, transitions, or complex audio mixing. For a pure "React app to RTMP" pipeline, Xvfb + Chrome + FFmpeg is simpler, lighter, and easier to scale.

---

## 6. Existing Open Source Projects

### 6a. `browserless/browserless`

- **URL**: https://github.com/browserless/browserless
- **What**: Chrome-as-a-Service. Docker containers running headless Chrome with an API.
- **Relevance**: Not directly streaming-focused, but provides the infrastructure for running managed Chrome instances at scale. Can be used as the browser management layer.
- **License**: Various (has open-source and commercial versions).

### 6b. `nichochar/headless-stream` / Similar Projects

Several proof-of-concept projects exist that combine Xvfb + Chrome + FFmpeg:

```dockerfile
# Typical Dockerfile for browser streaming
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    xvfb \
    google-chrome-stable \
    ffmpeg \
    pulseaudio

COPY entrypoint.sh /
CMD ["/entrypoint.sh"]
```

```bash
# entrypoint.sh pattern
#!/bin/bash
pulseaudio --start --exit-idle-time=-1
Xvfb :99 -screen 0 1920x1080x24 &
export DISPLAY=:99

google-chrome --no-sandbox --disable-gpu \
  --window-size=1920,1080 \
  --autoplay-policy=no-user-gesture-required \
  "$URL" &

sleep 3

ffmpeg -f x11grab -video_size 1920x1080 -framerate 30 -i :99 \
  -f pulse -i default \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -b:a 128k \
  -f flv "$RTMP_URL"
```

### 6c. `puppeteer-stream`

- **NPM Package**: `puppeteer-stream`
- **What**: Extends Puppeteer to capture audio/video streams using the `chrome.tabCapture` extension API.
- **How**: Loads a Chrome extension that uses `chrome.tabCapture.capture()` to get a MediaStream of the tab, then streams it via a local WebSocket or writes it.
- **Limitations**: Requires extension APIs (not available in pure headless). Requires headed mode + Xvfb. Audio capture works. Output is typically WebM.
- **Example**:

```js
import { launch, getStream } from 'puppeteer-stream';

const browser = await launch({
  executablePath: '/usr/bin/google-chrome',
  // Must use non-headless for extension APIs
  headless: false,
  args: ['--no-sandbox'],
});

const page = await browser.newPage();
await page.goto('http://localhost:3000');

const stream = await getStream(page, {
  audio: true,
  video: true,
  mimeType: 'video/webm;codecs=vp8,opus'
});

// Pipe to FFmpeg for RTMP conversion
const ffmpeg = spawn('ffmpeg', [
  '-i', 'pipe:0',
  '-c:v', 'libx264', '-preset', 'ultrafast',
  '-c:a', 'aac',
  '-f', 'flv', rtmpUrl
]);
stream.pipe(ffmpeg.stdin);
```

### 6d. `jrottenberg/ffmpeg` Docker Image

- Pre-built FFmpeg Docker images with all codecs compiled. Useful as a base layer.

### 6e. `selenium/video` (SeleniumHQ)

- The Selenium project includes a video recording sidecar container that uses FFmpeg + Xvfb to record browser sessions. Architecture is directly applicable.

### 6f. `xdotool` / `x11vnc` Based Approaches

Some projects use VNC to expose the virtual framebuffer, then capture the VNC stream. This adds unnecessary overhead compared to direct x11grab.

### 6g. `nichochar/browser-stream` Pattern

A common pattern seen in multiple projects:

```
Docker Container
  |-- Xvfb (virtual display)
  |-- PulseAudio (virtual audio)
  |-- Chrome/Chromium (renders the web app)
  |-- FFmpeg (captures display + audio, outputs RTMP)
  |-- Node.js (orchestration, health checks, API)
```

---

## 7. Scaling

### Resource Usage Per Stream Instance

**Chrome (rendering a React app):**
- CPU: 0.5-2.0 cores (depends on app complexity, animations, React re-renders)
- RAM: 300-800 MB (depends on page complexity, DOM size, JS heap)
- Baseline for a moderate React app: ~1 core, ~500 MB RAM

**FFmpeg (encoding 1080p30 H.264 ultrafast):**
- CPU: 0.3-0.8 cores (x264 ultrafast)
- RAM: ~100-200 MB
- With hardware encoding (NVENC): ~0% CPU, ~100 MB RAM

**Xvfb:**
- CPU: Negligible
- RAM: ~50-100 MB (framebuffer: 1920x1080x4 bytes = ~8 MB, plus overhead)

**PulseAudio:**
- CPU: Negligible
- RAM: ~30 MB

**Total per stream (software encoding):**
- CPU: 1.0-3.0 cores
- RAM: 500 MB - 1.2 GB
- Typical: ~1.5 cores, ~800 MB RAM

**Total per stream (hardware encoding):**
- CPU: 0.5-2.0 cores (just Chrome)
- GPU: One NVENC session
- RAM: 500 MB - 1.0 GB

### Docker Container Architecture

```yaml
# docker-compose.yml per stream
version: '3'
services:
  stream:
    build: .
    environment:
      - URL=http://host.docker.internal:3000/stream/abc123
      - RTMP_URL=rtmp://live.twitch.tv/app/KEY
      - RESOLUTION=1920x1080
      - FRAMERATE=30
    deploy:
      resources:
        limits:
          cpus: '2.0'
          memory: 1G
    shm_size: '2gb'  # Chrome needs shared memory
```

**Important**: Chrome uses `/dev/shm` (shared memory) heavily. Docker's default shm size (64MB) is too small. Always set `shm_size: '2gb'` or mount a tmpfs at `/dev/shm`.

### Streams Per Machine

| Machine Type | Cores | RAM | Streams (SW encode) | Streams (HW encode) |
|-------------|-------|-----|---------------------|---------------------|
| 4 core / 8 GB | 4 | 8 GB | 2 | 3 |
| 8 core / 16 GB | 8 | 16 GB | 4-5 | 7-8 |
| 16 core / 32 GB | 16 | 32 GB | 8-10 | 14-16 |
| 32 core / 64 GB | 32 | 64 GB | 16-20 | 28-32 |
| 96 core / 192 GB (c5.24xl) | 96 | 192 GB | 48-60 | N/A |

With GPU (e.g., g4dn.xlarge with T4):
- NVENC sessions: Up to ~30 simultaneous encodes on T4
- Bottleneck shifts to CPU for Chrome rendering

### Kubernetes Orchestration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: stream-worker
spec:
  replicas: 10  # Scale as needed
  template:
    spec:
      containers:
      - name: stream
        image: your-registry/stream-worker:latest
        resources:
          requests:
            cpu: "1500m"
            memory: "800Mi"
          limits:
            cpu: "2000m"
            memory: "1200Mi"
        volumeMounts:
        - name: dshm
          mountPath: /dev/shm
      volumes:
      - name: dshm
        emptyDir:
          medium: Memory
          sizeLimit: 2Gi
```

### Scaling Strategy

1. **Horizontal Pod Autoscaling**: Scale based on CPU utilization or custom metrics (active streams per pod).
2. **One container per stream**: Simplest isolation model. Container starts when stream goes live, stops when stream ends.
3. **Stream pool**: Pre-warm containers to reduce startup latency (Chrome cold start: 3-5s).
4. **Multi-stream per container**: Run multiple Xvfb displays (:99, :100, :101...) and Chrome instances per container. More efficient but harder to isolate failures.

---

## 8. Audio

### The Audio Problem

Chrome in headless/Xvfb mode has no audio output device by default. You need a virtual audio sink.

### PulseAudio Virtual Sink

```bash
# Start PulseAudio
pulseaudio --start --exit-idle-time=-1

# Create a virtual sink
pactl load-module module-null-sink sink_name=virtual_speaker sink_properties=device.description="Virtual_Speaker"

# Set as default
pactl set-default-sink virtual_speaker

# Chrome will output audio to this sink
# FFmpeg captures from the monitor of this sink
ffmpeg -f pulse -i virtual_speaker.monitor ...
```

### Full Pipeline with Audio

```bash
#!/bin/bash

# 1. Start PulseAudio
pulseaudio --start --exit-idle-time=-1
pactl load-module module-null-sink sink_name=chrome_audio

# 2. Start Xvfb
Xvfb :99 -screen 0 1920x1080x24 -ac &
export DISPLAY=:99

# 3. Start Chrome with audio
google-chrome --no-sandbox --disable-gpu \
  --window-size=1920,1080 \
  --autoplay-policy=no-user-gesture-required \
  --use-fake-ui-for-media-stream \
  http://localhost:3000 &

sleep 3

# 4. Stream with audio + video
ffmpeg \
  -f x11grab -video_size 1920x1080 -framerate 30 -i :99 \
  -f pulse -i chrome_audio.monitor \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -b:v 3000k -maxrate 3000k -bufsize 6000k \
  -pix_fmt yuv420p \
  -g 60 \
  -c:a aac -b:a 128k -ar 44100 \
  -shortest \
  -f flv "$RTMP_URL"
```

### Mixing TTS Audio with the Stream

**Option A: Play TTS audio through Chrome**

The simplest approach. Have your React app play TTS audio via the Web Audio API or `<audio>` elements. Since Chrome's audio output goes to PulseAudio, it gets captured by FFmpeg automatically.

```js
// In the React app
const audio = new Audio('https://api.elevenlabs.io/v1/text-to-speech/...');
audio.play();
```

**Option B: Mix at the FFmpeg level**

If TTS audio comes from an external source (e.g., a separate TTS service producing PCM/MP3):

```bash
ffmpeg \
  -f x11grab -video_size 1920x1080 -framerate 30 -i :99 \
  -f pulse -i chrome_audio.monitor \
  -f mp3 -i http://tts-service/stream \
  -filter_complex "[1:a][2:a]amix=inputs=2:duration=longest[aout]" \
  -map 0:v -map "[aout]" \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -c:a aac -b:a 128k \
  -f flv "$RTMP_URL"
```

**Option C: Mix at the PulseAudio level**

Multiple Chrome instances or audio sources can all output to the same PulseAudio sink. PulseAudio mixes them automatically. FFmpeg captures the mixed output.

### Web Audio API Capture

If you need to capture only specific audio from the page (not all Chrome audio):

```js
// In the React app - export audio via WebSocket
const audioCtx = new AudioContext();
const dest = audioCtx.createMediaStreamDestination();
// Connect your audio sources to dest
myOscillator.connect(dest);
myTTSSource.connect(dest);

const recorder = new MediaRecorder(dest.stream);
recorder.ondataavailable = (e) => {
  ws.send(e.data);  // Send to server
};
recorder.start(100);  // 100ms chunks
```

**Recommended approach:** Option A (play audio in Chrome, capture via PulseAudio). It is the simplest and keeps the audio synchronized with the visual content by default.

---

## 9. Latency

### End-to-End Latency Breakdown

```
React render -> Chrome compositor -> Xvfb framebuffer -> FFmpeg capture
    ~16ms          ~0-16ms              ~0ms               ~33ms (at 30fps)

FFmpeg capture -> x264 encode -> RTMP transmit -> CDN ingest -> CDN edge
    ~33ms          ~10-50ms       ~50-200ms       ~500-3000ms    ~1-5s

CDN edge -> HLS/DASH segment -> Player buffer -> Display
   ~0ms        ~2-10s             ~2-6s          ~0ms
```

### Latency by Delivery Method

| Method | Typical Latency | Best Case |
|--------|----------------|-----------|
| RTMP ingest to Twitch/YouTube viewer (HLS) | 5-15 seconds | 3-5 seconds (low-latency mode) |
| Twitch Low Latency mode | 2-5 seconds | ~2 seconds |
| YouTube Ultra Low Latency | 3-6 seconds | ~3 seconds |
| Custom RTMP -> HLS (3s segments) | 6-12 seconds | ~6 seconds |
| Custom RTMP -> LL-HLS | 2-4 seconds | ~2 seconds |
| Custom WebRTC (direct) | 0.1-0.5 seconds | ~100ms |
| Custom WHEP/WHIP (WebRTC) | 0.2-1.0 seconds | ~200ms |

### Latency Optimization Strategies

**At the capture layer:**
- Use 30fps, not 60fps (halves encoding work, minimal visual difference for most React apps).
- `-tune zerolatency` in x264 disables B-frames and reduces lookahead.
- `-preset ultrafast` minimizes encode latency at the cost of quality/bitrate efficiency.

**At the transport layer:**
- `-g 60` (keyframe every 2s at 30fps) -- shorter GOP = faster seeking but higher bitrate.
- Use RTMP, not RTMPS, for internal transport (saves TLS overhead). Use RTMPS only for external endpoints.

**At the delivery layer:**
- LL-HLS (Low-Latency HLS) with partial segments: 2-4s latency.
- WebRTC via WHIP/WHEP: Sub-second latency.
- SRT protocol for inter-server transport: Lower latency than RTMP.

**For the custom player:**
- If you control the player, WebRTC (via WHIP ingest, WHEP playback) gives the lowest latency (~200-500ms).
- Use a media server like **Pion** (Go), **mediasoup** (Node.js), or **LiveKit** to bridge RTMP to WebRTC.

### Achievable Targets

| Scenario | Achievable Latency |
|----------|-------------------|
| Chrome -> Custom WebRTC player | 200ms - 1s |
| Chrome -> Custom LL-HLS player | 2s - 4s |
| Chrome -> Twitch viewer (low-latency) | 2s - 5s |
| Chrome -> YouTube viewer (ultra-low) | 3s - 6s |
| Chrome -> YouTube viewer (standard) | 8s - 15s |

---

## 10. Cost Estimation

### Target: ~$0.10/hr Per Stream

### AWS Pricing Analysis (us-east-1, on-demand)

**Software encoding (CPU only):**

| Instance | vCPUs | RAM | $/hr | Streams/instance | $/hr/stream |
|----------|-------|-----|------|-----------------|-------------|
| c6i.xlarge | 4 | 8 GB | $0.17 | 2 | $0.085 |
| c6i.2xlarge | 8 | 16 GB | $0.34 | 5 | $0.068 |
| c6i.4xlarge | 16 | 32 GB | $0.68 | 10 | $0.068 |
| c6i.8xlarge | 32 | 64 GB | $1.36 | 20 | $0.068 |
| c7g.2xlarge (ARM) | 8 | 16 GB | $0.29 | 4-5 | $0.064 |
| m6i.2xlarge | 8 | 32 GB | $0.38 | 5 | $0.076 |

**Hardware encoding (GPU):**

| Instance | GPUs | vCPUs | RAM | $/hr | Streams/instance | $/hr/stream |
|----------|------|-------|-----|------|-----------------|-------------|
| g4dn.xlarge | 1x T4 | 4 | 16 GB | $0.526 | 3-4 | $0.13-0.18 |
| g4dn.2xlarge | 1x T4 | 8 | 32 GB | $0.752 | 7-8 | $0.094-0.107 |
| g4dn.12xlarge | 4x T4 | 48 | 192 GB | $3.912 | 30-40 | $0.098-0.130 |

**With Reserved Instances / Savings Plans (1yr, no upfront):**
- ~40% discount, bringing c6i.2xlarge to ~$0.041/stream/hr.

**With Spot Instances:**
- ~60-70% discount on c6i, but risk of interruption.
- Viable for non-critical streams with failover logic.

### Hetzner / Bare Metal (Lower Cost)

| Server | Cores | RAM | $/mo | $/hr | Streams | $/hr/stream |
|--------|-------|-----|------|------|---------|-------------|
| Hetzner CCX23 | 4 dedicated | 16 GB | $22 | $0.030 | 2 | $0.015 |
| Hetzner CCX33 | 8 dedicated | 32 GB | $42 | $0.058 | 5 | $0.012 |
| Hetzner CCX53 | 16 dedicated | 64 GB | $80 | $0.111 | 10 | $0.011 |
| Hetzner AX102 (dedicated) | 16C/32T | 128 GB | $130 | $0.180 | 15-20 | $0.009-0.012 |

**Verdict on cost:** $0.10/hr per stream is very achievable with CPU-only encoding on cloud instances, and easily beaten with reserved instances or bare metal. At scale (50+ streams), bare metal from Hetzner or OVH brings costs to ~$0.01-0.02/hr per stream.

### Cost Breakdown Per Stream

```
Chrome rendering:       ~$0.03-0.05/hr  (CPU share)
FFmpeg encoding:        ~$0.02-0.03/hr  (CPU share)
Memory:                 ~$0.005-0.01/hr
Network egress (3Mbps): ~$0.01-0.02/hr  (varies by provider)
Orchestration overhead: ~$0.005/hr
---
Total:                  ~$0.07-0.13/hr
```

### Bandwidth Costs

A 1080p30 stream at 3-4.5 Mbps = ~1.35-2.0 GB/hr outbound per destination.

| Provider | Egress $/GB | Cost/hr (4 Mbps stream) |
|----------|------------|------------------------|
| AWS | $0.09 | $0.162 |
| GCP | $0.08 | $0.144 |
| Azure | $0.087 | $0.157 |
| Hetzner | $0.00 (20 TB included) | ~$0.00 |
| OVH | $0.00 (included) | ~$0.00 |
| Cloudflare | $0.00 (egress free) | ~$0.00 |

**Important:** On AWS/GCP/Azure, egress costs can exceed compute costs. For cost-sensitive deployments, use Hetzner/OVH for RTMP output, or route through Cloudflare.

---

## 11. Recommended Architecture

### Primary Architecture: Xvfb + Chrome + PulseAudio + FFmpeg

```
                    Docker Container (per stream)
                    +-----------------------------------------------+
                    |                                               |
  React App ------->  Chrome (headed, via Puppeteer/Playwright)    |
  (served via      |       |                                       |
   HTTP/localhost)  |       +--renders to--> Xvfb :99              |
                    |       |                                       |
                    |       +--audio to----> PulseAudio sink        |
                    |                                               |
                    |  FFmpeg                                       |
                    |       +--x11grab from-- Xvfb :99             |
                    |       +--pulse from---- PulseAudio monitor   |
                    |       |                                       |
                    |       +--RTMP out-----> Twitch               |
                    |       +--RTMP out-----> YouTube              |
                    |       +--RTMP out-----> Custom RTMP server   |
                    |                                               |
                    |  Node.js Orchestrator                         |
                    |       +--launches Chrome via Puppeteer        |
                    |       +--manages FFmpeg process               |
                    |       +--health checks, restarts              |
                    |       +--API for stream control               |
                    +-----------------------------------------------+
```

### Technology Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Browser | Chrome (via Puppeteer) | Full rendering fidelity, CDP for control |
| Display | Xvfb | Lightweight, standard, zero-overhead capture |
| Audio | PulseAudio | Chrome's native audio output, easy FFmpeg capture |
| Encoding | FFmpeg (libx264 ultrafast) | Best quality/speed/cost at software encoding |
| Transport | RTMP | Universal support (Twitch, YouTube, custom) |
| Low-latency delivery | WHIP/WHEP (WebRTC) | Sub-second for custom player |
| Container | Docker | Isolation, reproducibility, scaling |
| Orchestration | Kubernetes | Horizontal scaling, health management |
| Orchestrator | Node.js | Manages Puppeteer, FFmpeg, health, API |

### Startup Sequence

```bash
#!/bin/bash
set -e

# 1. Audio
pulseaudio --start --exit-idle-time=-1
pactl load-module module-null-sink sink_name=chrome_sink

# 2. Display
Xvfb :99 -screen 0 ${RESOLUTION:-1920x1080}x24 -ac &
export DISPLAY=:99

# 3. Chrome (managed by Node.js/Puppeteer, or directly)
node /app/orchestrator.js &
# orchestrator.js launches Chrome, navigates to URL, monitors health

# 4. Wait for Chrome to be ready
sleep 3

# 5. FFmpeg
exec ffmpeg \
  -f x11grab -video_size ${RESOLUTION:-1920x1080} -framerate ${FPS:-30} -i :99 \
  -f pulse -i chrome_sink.monitor \
  -c:v libx264 -preset ultrafast -tune zerolatency \
  -b:v ${BITRATE:-3000}k -maxrate ${BITRATE:-3000}k -bufsize $((BITRATE*2))k \
  -pix_fmt yuv420p -g $((FPS*2)) \
  -c:a aac -b:a 128k -ar 44100 \
  -f flv "${RTMP_URL}"
```

### Multi-Destination via nginx-rtmp

For streaming to multiple destinations without encoding multiple times:

```nginx
# nginx.conf
rtmp {
    server {
        listen 1935;
        application relay {
            live on;
            push rtmp://live.twitch.tv/app/TWITCH_KEY;
            push rtmp://a.rtmp.youtube.com/live2/YT_KEY;
            push rtmp://custom-server/live/CUSTOM_KEY;
        }
    }
}
```

FFmpeg encodes once and sends to `rtmp://localhost/relay/stream`. nginx-rtmp fans out to all destinations with negligible additional CPU cost.

### Custom Low-Latency Player

For the custom player with sub-second latency:

1. **Ingest**: FFmpeg -> WHIP -> Media server (e.g., LiveKit, Cloudflare Stream with WebRTC)
2. **Playback**: WHEP -> Browser player

Or simpler:

1. **Ingest**: FFmpeg -> RTMP -> Media server
2. **Transcode**: Media server -> WebRTC
3. **Playback**: WebRTC player in browser

**LiveKit** is worth considering as an all-in-one solution for the custom player path. It accepts RTMP ingest and serves WebRTC playback with ~200ms latency.

### Monitoring and Health Checks

```js
// orchestrator.js health checks
async function healthCheck() {
  // 1. Is Chrome alive?
  const pages = await browser.pages();
  if (pages.length === 0) throw new Error('No pages');

  // 2. Is the page responding?
  const title = await pages[0].title();

  // 3. Is FFmpeg running?
  if (ffmpegProcess.exitCode !== null) throw new Error('FFmpeg exited');

  // 4. Is FFmpeg producing output? (check stderr for fps/bitrate)
  // FFmpeg logs "frame=  123 fps= 30 q=25.0 size=    1234kB ..."
}
```

---

## Summary of Key Decisions

| Decision | Recommendation | Rationale |
|----------|---------------|-----------|
| Capture method | Xvfb + FFmpeg x11grab | Industry standard, 30fps, reliable |
| Browser mode | Chrome headed in Xvfb (not headless) | Full rendering + audio support |
| Browser control | Puppeteer | CDP access, page management, script injection |
| Video encoding | libx264 ultrafast (CPU) or NVENC (GPU) | Cost-effective, low latency |
| Audio capture | PulseAudio virtual sink | Chrome-native, works out of the box |
| RTMP fanout | nginx-rtmp relay | Encode once, distribute to many |
| Container model | One Docker container per stream | Simple isolation, easy scaling |
| Custom player delivery | WebRTC via LiveKit or WHIP/WHEP | Sub-second latency |
| Scaling | Kubernetes HPA | Auto-scale on demand |
| Target cost | $0.06-0.10/hr per stream (cloud) | Achievable on c6i instances |
| Target latency | 2-5s to Twitch/YT, <1s to custom player | Standard for live streaming |

### What NOT to Use

| Technology | Why Not |
|-----------|---------|
| CDP screencast | 5-15 fps, no audio, inconsistent frame delivery |
| Puppeteer `page.screenshot()` loop | Too slow (3-10 fps), no audio |
| Remotion | Offline rendering only, not designed for live |
| WebRTC from Chrome | Over-engineered, requires signaling infrastructure |
| OBS (alone) | Harder to automate and scale vs. FFmpeg |
| VNC-based capture | Unnecessary overhead |
