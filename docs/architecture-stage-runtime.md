# Architecture: stage-runtime (Rust Stage Runtime)

> **Location:** `stage-runtime/`

The stage runtime is a pure-Rust GPU-accelerated stage renderer that replaces Chrome + Xvfb + x11grab + ffmpeg. It renders Canvas 2D, WebGL2, HTML/CSS, and Web Audio in-process, composites per frame, and encodes to H.264/AAC for RTMP output. At 720p it runs the full pipeline at **413 fps** (13.7x headroom over 30fps target) and is **4-7x faster than Chrome** at identical render + readback work.

Fully integrated as a drop-in replacement for Chrome on both CPU and GPU stages. Enable with `STREAMER_RENDERER=native` (CPU) or `RENDERER=native` (GPU). Chrome remains the default.

---

## High-Level Architecture

```
                         ┌──────────────────────────────────────────┐
                         │              main.rs                      │
                         │  CLI args → V8 init → content load → CDP │
                         └───────────────────┬──────────────────────┘
                                             │
                         ┌───────────────────▼──────────────────────┐
                         │         cdp::serve (FIFO pipe loop)      │
                         │  CDP commands in → tick_frame → events out│
                         │  FramePacer: spin-wait for target FPS    │
                         └───────────────────┬──────────────────────┘
                                             │
                         ┌───────────────────▼──────────────────────┐
                         │       runtime::tick_frame (per frame)     │
                         │  1. Advance virtual time                  │
                         │  2. Fire image onload callbacks           │
                         │  3. Execute timers + rAF callbacks (V8)   │
                         │  4. Drain fetch/WebSocket I/O             │
                         │  5. Process render commands                │
                         │  6. Composite layers → framebuffer        │
                         │  7. Render audio frame (PCM)              │
                         │  8. Encode video+audio → RTMP             │
                         └──────────────────────────────────────────┘
```

### Rendering Pipeline

```
HTML/CSS → html5ever → CSS cascade → taffy layout → tiny-skia paint → background pixmap (once)
                                                                              ↓
GLSL ES 3.0 → naga → WGSL → wgpu pipeline → GPU render → readback ── composite ──→ RGBA framebuffer
                                                                          ↑               ↓
Canvas2D cmds → tiny-skia → premultiplied pixmap ─────────────────────────┘        ffmpeg-next
                                                                              (libx264 / NVENC)
                                                                                      ↓
JS AudioContext → __dz_audio_cmds → web-audio-api crate                        H.264 + AAC
  + Chrome compressor port → interleaved stereo PCM ──────────────────────→     FLV → RTMP
```

### Frame Composition Order

Layers composite bottom-to-top with premultiplied alpha blending:

1. **HTML/CSS background** — rendered once on content load (or on `Page.navigate`)
2. **WebGL2** — GPU render target read back each frame (if commands were dispatched)
3. **Canvas 2D** — CPU pixmap composited on top (if commands were dispatched)

---

## Modules

### `runtime/` — V8 Engine & Frame Loop

The core execution engine. Initializes V8, registers browser API polyfills, and drives the per-frame tick.

**Central struct: `RendererState`** — holds framebuffer, Canvas 2D context, WebGL2 context, audio graph, storage, encoder, and networking state. All mutable state for a running stage lives here.

**Key functions:**
- `init_v8()` — one-time V8 platform init (static Once)
- `init_globals()` — registers `console`, `window`, `document`, `localStorage`, Canvas 2D + WebGL2 polyfills, `fetch`, `XMLHttpRequest`, `Image`, timers, `requestAnimationFrame`
- `tick_frame()` — per-frame orchestrator (timers → rAF → fetch → render → composite → encode)
- `process_render_commands()` — drains JS command buffers, dispatches to Canvas 2D / WebGL2 / audio, composites layers
- `register_native_callbacks()` — installs V8 native function callbacks for `__dz_canvas_cmd`, `__dz_canvas_put_image_data`, `__dz_canvas_get_image_data`, `__dz_measure_text`, `__dz_resolve_fetch`, `console.*`

**JS ↔ Rust bridge pattern:** Canvas 2D uses **native V8 callbacks** that dispatch directly to `Canvas2D::dispatch_command()` — zero JSON serialization per draw call. WebGL2 and audio buffer commands in JS arrays (`__dz_webgl_cmds`, `__dz_audio_cmds`) drained once per frame.

### `canvas2d/` — Canvas 2D Renderer (tiny-skia)

CPU-based 2D rendering implementing the Canvas 2D API.

- **Backend:** tiny-skia (Rust port of Skia's rasterizer)
- **Text:** fontdue for glyph metrics + rasterization (bundled DejaVu Sans)
- **Features:** fill/stroke, paths (lines, arcs, beziers, ellipses), transforms (save/restore stack), clipping, gradients (linear/radial), patterns, shadows, composite operations, `drawImage` (all 3 overloads), `getImageData`/`putImageData`
- **Output:** premultiplied RGBA pixmap, composited onto framebuffer via `read_pixels_premultiplied()`
- **Dirty tracking:** `frame_dirty` flag — skip composite when no draw commands this frame

### `webgl2/` — WebGL2 Renderer (wgpu)

GPU-accelerated WebGL2 rendering via the wgpu abstraction layer.

- **Backend:** wgpu (WebGPU API → Metal/Vulkan/DX12 depending on platform)
- **Shader compilation:** GLSL ES 3.0 → preprocessed → naga → WGSL. Handles `#version 300 es`, layout qualifiers, sampler2D → texture+sampler remapping, Z-depth remap (OpenGL [-1,+1] → wgpu [0,+1])
- **State machine:** Full GLState tracking — blend, depth, cull, scissor, stencil, textures, vertex attributes, programs, UBOs
- **Pipeline caching:** `HashMap<PipelineKey, CachedPipeline>` keyed on shader + vertex layout + blend + depth config
- **Error queue:** Per-spec GL error recording with deduplication (INVALID_ENUM, INVALID_VALUE, INVALID_OPERATION)
- **Coverage:** ~80 GL constants, ~90 methods including instanced drawing, integer uniforms, UBO binding, transform feedback stubs, query/sync/sampler stubs
- **Output:** RGBA8Unorm render target → CPU readback → premultiplied composite onto framebuffer

### `htmlcss/` — HTML/CSS Renderer (html5ever + taffy + tiny-skia)

Static HTML/CSS rendering for stage backgrounds.

- **Parse:** html5ever → RcDom tree
- **Style:** CSS cascade resolution (70+ properties: display, position, box model, flexbox, grid, colors, gradients, fonts, opacity)
- **Layout:** taffy flex/grid layout engine
- **Paint:** tiny-skia pixmap (text, backgrounds, borders, border-radius, images)
- **Script extraction:** `<script>` tags (inline + `src=`) extracted and returned for V8 execution
- **Rendered once** on content load, not per-frame

### `audio/` — Web Audio Engine (web-audio-api crate)

Spec-compliant Web Audio API rendering, frame-locked with video.

- **Backend:** `web-audio-api` Rust crate (W3C OfflineAudioContext)
- **Chrome alignment patches:**
  1. PeriodicWave Fourier synthesis for square/sawtooth (band-limited wavetable matching Chrome)
  2. DynamicsCompressor — direct port of Blink's `dynamics_compressor.cc` (adaptive polynomial release, 6ms pre-delay, sin(π/2) post-warp)
- **Rendering:** Re-renders entire timeline from t=0 each frame via OfflineAudioContext to maintain oscillator phase / filter state continuity. Returns final frame's interleaved stereo PCM (1470 samples at 44.1kHz/30fps).
- **Chrome match:** 67 tests, RMSE < 0.001 for sine/triangle/gain/delay/pan, < 0.055 for biquad filters, 0.024 for compressor

### `encoder/` — Video/Audio Encoder (ffmpeg-next)

H.264 + AAC encoding to FLV for RTMP output. Feature-gated behind `encoder` flag.

- **Video:** RGBA → swscale (YUV420P) → libx264 or h264_nvenc
- **Audio:** f32 PCM → ffmpeg resampler → AAC
- **Mux:** FLV container → RTMP URL
- **Multi-output:** Supports multiple simultaneous RTMP destinations with diffing (only restarts changed outputs)
- **Defaults:** 2.5 Mbps video, 128 kbps audio, 2s keyframe interval

### `cdp/` — Chrome DevTools Protocol Server

CDP-over-FIFO interface — the control surface the sidecar uses to drive stage-runtime.

- **Transport:** Named pipes (FIFO). Null-byte delimited JSON messages. Input pipe read first to unblock sidecar's write-open.
- **Standard commands:** `Target.*` (discover, get, create, attach), `Runtime.evaluate`, `Page.navigate`, `Page.reload`, `Page.captureScreenshot`, `Runtime.enable`, `Log.enable`
- **Custom domain:** `StageRuntime.setOutputs` (configure RTMP destinations), `StageRuntime.getStats` (renderer stats)
- **Events:** `Runtime.consoleAPICalled`, `Target.attachedToTarget`
- **Frame pacing:** FramePacer uses OS sleep for ~99.95% of interval, spin-wait for final 500µs

See [cdp-extensions.md](../stage-runtime/docs/cdp-extensions.md) for the full CDP protocol reference.

### `content/` — Content Loading

Loads `index.html` / `index.js` from the content directory.

- Extracts inline `<script>` blocks and resolves external `<script src="...">` paths
- Decodes PNG/JPEG/WebP images via the `image` crate
- `fetch()` for relative URLs resolves synchronously from content_dir; network URLs use reqwest on background threads

### `storage/` — Persistent Key-Value Store

`localStorage` replacement — JSON file on disk, synced to R2 by the sidecar.

- `HashMap<String, serde_json::Value>` backed by `storage.json`
- 1-second write debounce; flush on Drop
- Survives content reloads (not cleared by `Page.navigate`)

### `compositor/` — Frame Compositing

Composites HTML background + WebGL2 + Canvas 2D layers into the final RGBA framebuffer using premultiplied alpha blending.

### `stats/` — Statistics

Frame count, actual FPS, virtual time tracking. Exposed via `StageRuntime.getStats` CDP command.

---

## CLI Arguments

```
stage-runtime \
  --content-dir /path/to/content \
  --data-dir /path/to/data \
  --cdp-pipe-in /tmp/cdp_in \
  --cdp-pipe-out /tmp/cdp_out \
  --width 1280 \
  --height 720 \
  --fps 30 \
  --video-codec libx264 \
  --gpu-device-index 0
```

All args also accept env vars: `CONTENT_DIR`, `DATA_DIR`, `CDP_PIPE_IN`, `CDP_PIPE_OUT`.

---

## Feature Flags

| Flag | Default | What it enables |
|------|---------|----------------|
| `v8-runtime` | **yes** | V8 engine, Canvas 2D (tiny-skia), WebGL2 (wgpu), HTML/CSS (html5ever + taffy) |
| `encoder` | no | ffmpeg-next video/audio encoding (requires FFmpeg dev headers) |

---

## Key Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| `v8` | 146 | V8 JavaScript engine |
| `tiny-skia` | 0.12 | Canvas 2D + HTML/CSS CPU rasterization |
| `wgpu` | 29 | WebGL2 GPU rendering (Metal/Vulkan/DX12) |
| `naga` | 29 | GLSL → WGSL shader compilation |
| `fontdue` | 0.9 | Font glyph metrics + rasterization |
| `html5ever` | 0.38 | HTML parsing |
| `taffy` | 0.9 | CSS flexbox/grid layout |
| `web-audio-api` | 1.2 | W3C-compliant audio graph |
| `ffmpeg-next` | 8 | H.264/AAC encoding + FLV muxing |
| `image` | 0.25 | PNG/JPEG/WebP decoding |
| `reqwest` | 0.12 | HTTP client (fetch API) |
| `tungstenite` | 0.24 | WebSocket client |
| `tokio` | 1 | Async runtime |

---

## Performance (M3 MacBook Pro, 1280x720)

### End-to-End Pipeline

| Path | Throughput | p50 | p99 |
|------|-----------|-----|-----|
| Full composite + encode | **413 fps** | 2.42ms | 2.79ms |
| WebGL2-only + encode | **448 fps** | 2.24ms | 2.93ms |
| Render-only (no encode) | **2184 fps** | 445µs | 634µs |
| Encode-only (static) | **524 fps** | 1.88ms | 2.49ms |

### vs Chrome (identical render + full-frame readback)

| Scene | Chrome p50 | stage-runtime p50 | Speedup |
|-------|-----------|-------------------|---------:|
| terrain_lit (1089 verts) | 1.90ms | 468µs | **4.1x** |
| cubes_lit_25 (25 draws) | 1.90ms | 463µs | **4.1x** |
| raymarched_spheres (SDF) | 2.15ms | 305µs | **7.0x** |
| particles_256 (alpha) | 1.90ms | 484µs | **3.9x** |
| normal_perturb (procedural) | 1.90ms | 303µs | **6.3x** |

### Pixel Accuracy vs Chrome

| Renderer | Scenes | Pixel-perfect | Rate | Max RMSE |
|----------|--------|---------------|------|----------|
| WebGL2 | 63 | 57 | 90.5% | 0.050 |
| Canvas 2D | 85 | 31 | 36.5% | 0.034 |

Canvas 2D diffs are 1px edge bands — inherent to tiny-skia vs Chrome's Skia AA implementations.

---

## Tests & Benchmarks

```bash
# All tests (763 total)
cargo test --features v8-runtime

# With encoding tests
cargo test --features v8-runtime,encoder

# Benchmarks
cargo bench --features v8-runtime,encoder --bench e2e_encode_bench
cargo bench --features v8-runtime --bench render_bench
cargo bench --features v8-runtime --bench htmlcss_bench
```

**Test categories:**
- 85 Canvas 2D reference image tests (vs Chrome-generated truth PNGs)
- 63 WebGL2 reference image tests
- 67 Web Audio Chrome reference tests (46 reference + 21 offline)
- 80 property-based tests (proptest) — Canvas 2D state, transforms, colors, timers, classList, WebGL2 state machine, AudioParam scheduling, HTML/CSS robustness
- 24 browser gap tests — CSS var(), calc(), backdrop-filter, box-shadow, Workers, `<link>` stylesheets, transforms, SVG, IndexedDB, animations
- 23 WebGL2 unit tests (error queue, instanced draw, uniforms, blend, constants)

---

## Browser API Coverage

Features matching the llms.txt / guide.md contract:

| Feature | Status |
|---------|--------|
| Canvas 2D | Full (tiny-skia), all composite operations, patterns |
| WebGL2 | Extensive (~90 methods, GPU-accelerated, native V8 callbacks) |
| Web Audio | Chrome-aligned (web-audio-api crate + Blink compressor port) |
| CSS custom properties (`var()`) | Full inheritance + fallback values |
| CSS `calc()` | Supported (px, %, em, vw, vh units, arithmetic) |
| CSS `transform` | Supported (translate, rotate, scale, skew, matrix) |
| CSS `@keyframes` animations | JS-side engine (parses @keyframes, drives style mutations per frame) |
| CSS transitions | JS-side engine (intercepts style changes, interpolates over duration) |
| CSS `backdrop-filter` | `blur()` function (3-pass box blur approximation) |
| CSS `box-shadow` | Multiple shadows, blur, spread, offset, rgba colors |
| SVG rendering | Via resvg (`<img src="*.svg">` + inline `<svg>` in HTML) |
| `<link rel="stylesheet">` | Local + remote CSS (Google Fonts, CDN stylesheets) |
| CDN `<script src="https://...">` | Fetched at load time via reqwest |
| Web Workers | Single-threaded execution (message passing via setTimeout) |
| IndexedDB | In-memory JS shim backed by localStorage persistence |
| `fetch()` / XMLHttpRequest | Async via background threads (local + network) |
| WebSocket | Background thread connections via tungstenite |
| `crypto.getRandomValues()` | Implemented (Math.random-based, not CSPRNG) |
| localStorage / sessionStorage | Persistent via R2 |
| DOM manipulation | Polyfill DOM (createElement, querySelector, classList, style, etc.) |
| MutationObserver / ResizeObserver | Implemented |
| Dirty DOM re-render | Style/DOM mutations trigger per-frame HTML re-render |

**Not implemented (intentional):** ServiceWorker, WebRTC, full CSS cascade/layout on every frame (HTML re-render uses the htmlcss pipeline on DOM dirty).

## Sidecar Integration

stage-runtime communicates with the Go sidecar via CDP over named FIFO pipes — the same interface Chrome uses, making it a wire-compatible drop-in replacement. The sidecar's `PipeClient` handles all CDP routing.

### How to enable

| Stage type | Env var | Where to set |
|---|---|---|
| CPU (k8s pod) | `STREAMER_RENDERER=native` | Control-plane deployment |
| GPU (RunPod agent) | `RENDERER=native` | GPU node pod env |

### What changes at runtime

**CPU stages:** The streamer container (`entrypoint.sh`) skips Xvfb, PulseAudio, and Chrome. Creates CDP FIFOs in `/tmp/cdp/` (shared volume with sidecar), launches `/stage-runtime` directly. The sidecar connects via `PipeClient` instead of Chrome's WebSocket on port 9222.

**GPU stages:** The agent (`stage.go`) passes `RENDERER` to each stage process. `stage-start.sh` dispatches to `/stage-runtime` instead of Chrome.

### SetOutputs routing

When the sidecar detects it's using `PipeClient` (pipe mode = stage-runtime), `SetOutputs` RPC calls are routed to `StageRuntime.setOutputs` via CDP — the Rust encoder owns ffmpeg. In Chrome mode, the sidecar's Go `pipeline` package manages ffmpeg as before.

### Persistence

Same R2 model, same owner (sidecar):

| Data | Chrome mode | stage-runtime mode |
|---|---|---|
| Stage content | `/data/content/` → R2 | Same |
| localStorage | `/data/chrome/Default/Local Storage/` → R2 | `/data/storage.json` → R2 |
| Restore | Init container restores Chrome dirs | Init container restores `storage.json` |

The sidecar's `isRestorablePath()` checks `RENDERER` to decide which paths to sync/restore.

### Build

The stage-runtime binary is built via `stage-runtime/Dockerfile` and copied into both CPU and GPU images via the `DAZZLE_RENDER_IMAGE` Docker build arg. When the arg is omitted, a glob trick (`dazzle-rende[r]`) makes the COPY a no-op — existing Chrome-only builds are unaffected.

```bash
make build-stage-runtime    # Build Rust binary (linux/amd64)
make build-streamer          # Includes stage-runtime in CPU image
make gpu/rebuild             # Includes stage-runtime in GPU image
```
