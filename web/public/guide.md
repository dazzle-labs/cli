# Dazzle Content Authoring Guide

Your content runs in a cloud browser captured at 1280x720 @ 30 fps. There is no
hardware GPU — rendering is done in software on shared CPU. This guide helps you
write content that looks great within these constraints.

## Environment at a Glance

| Setting     | Value                                          |
|-------------|------------------------------------------------|
| Resolution  | 1280x720 (fixed)                               |
| Frame rate  | 30 fps (captured via x11grab → x264)           |
| Renderer    | Software OpenGL (no hardware GPU)                |
| CPU budget  | ~50% used by capture/encode; your content gets the rest |
| Browser     | Headless Chrome, kiosk mode, full viewport      |
| Audio       | PulseAudio capture (Web Audio API works)        |
| Persistence | localStorage and IndexedDB survive restarts     |

## Page Setup

Always start with a full-viewport, no-scroll layout:

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #000; }
  </style>
</head>
<body>
  <!-- your content -->
</body>
</html>
```

For canvas-based content, size to the window:

```js
const W = canvas.width = window.innerWidth;   // 1280
const H = canvas.height = window.innerHeight;  // 720
```

Do NOT hardcode 1920x1080 — the viewport is 1280x720.

## What Works Well (60 FPS)

**CSS animations & transitions**
- `@keyframes`, `transition`, `transform`, `opacity` — all smooth at 60 fps
- CSS is the cheapest way to animate; prefer it over JS when possible

**Canvas 2D**
- Drawing, compositing, particle effects — efficient even with 300+ particles
- Good for dashboards, visualizations, generative art, text rendering

**DOM-heavy animation**
- 200+ elements repositioned every frame via JS — still 59 fps
- `requestAnimationFrame`-driven layouts work well

**WebGL**
- Geometry, materials (flat, Phong, PBR), instanced rendering — full 60 fps
- Fragment shaders including raymarching, SDF, noise functions — 60 fps
- Three.js, p5.js, custom WebGL — all perform well

**Web Audio API**
- Oscillators, gain nodes, audio buffers — captured by PulseAudio
- Good for music visualizers, sound effects, generative audio

**CDN libraries**
- Load via `<script>` or `<link>` from CDNs (unpkg, cdnjs, etc.)
- Three.js, D3, GSAP, Tone.js, p5.js — all work

## WebGL Performance

All standard WebGL workloads hit 60 FPS at 1280x720, including fragment-heavy
scenes:

| Scene                                      | FPS |
|--------------------------------------------|-----|
| Mesh-based WebGL (Phong, PBR, 5K tris)     | 60  |
| Full-screen SDF raymarcher (48 steps)       | 60  |
| Terrain + 6-octave FBM noise (100 steps)    | 60  |

### What works
- Raymarching, signed distance fields, noise functions
- Multi-pass rendering (bloom, blur, post-processing)
- Fragment-heavy shaders (per-pixel lighting, volumetrics)
- Instanced rendering, morph targets, displacement maps

### What to watch for
- Very high triangle counts (>50K) may start to drop
- Multiple render targets with heavy shaders compound cost
- Keep an eye on `dazzle s stats` — if Stage FPS drops below 30, simplify

## What to Avoid

**`backdrop-filter` (blur, brightness, etc.)**
- Very expensive in software rendering — avoid entirely
- Use pre-blurred background images or solid overlays instead

**Large assets**
- Keep images under 2 MB each; use compressed formats (WebP, AVIF)
- Sprite sheets over many individual images
- Avoid loading video files — you ARE the video output

**`box-shadow` with large spread/blur**
- Multiple stacked shadows are expensive in software rendering
- Use 1–2 subtle shadows max, or fake with border/gradient

**Main thread blocking**
- No long-running synchronous JS (large JSON parse, crypto, etc.)
- Dropped frames are visible in the stream — keep the main thread clear

## Design Tips for 720p Streaming

**Text**
- Minimum 16px for body text, 24px+ for headings
- High contrast: light text on dark background (or vice versa)
- Sans-serif fonts render more cleanly at this resolution
- Google Fonts via `<link>` work fine
- Avoid thin font weights (100–300) — they disappear at 720p

**Colors & contrast**
- Dark backgrounds (`#000` or near-black) are the stage default
- Use bold, saturated colors — subtlety gets lost in compression
- Avoid fine gradients that may band in x264 encoding

**Layout**
- Design for 16:9 (1280x720) — no scrolling, no overflow
- Keep important content away from edges (safe area: ~40px inset)
- Larger UI elements read better on stream than small detailed ones

**Animation**
- Target 30 fps or below — anything faster is wasted (capture is 30 fps)
- Ease-in-out curves look smoother than linear at low frame rates
- Avoid very fast motion that causes x264 motion blur artifacts

## Performance Monitoring

Check your stage's live rendering performance:

```
dazzle s stats
```

Output:
```
Stage FPS:       59.8
Broadcast FPS:   30.0
Dropped Frames:  0 (0 last 60s)
Data:            142.50 MB
Broadcasting:    no
Uptime:          2h 15m
```

- **Stage FPS** — how fast Chrome is rendering your content. This is the real
  quality metric. If this drops below 30, your content is too heavy.
- **Broadcast FPS** — the encoder output rate. Should stay at 30.0.

Take screenshots to verify your content looks correct:

```
dazzle s ss -o check.png
```

## Persistence & Live Updates

**localStorage**
- Persisted to cloud storage; survives stage restarts
- Use for app state, user preferences, accumulated data

**Events (real-time data channel)**
- Push data without reloading: `dazzle s ev e <name> '<json>'`
- Listen: `window.addEventListener('event', e => { ... })`
- Good for scores, alerts, chat messages, external data feeds

**Sync auto-refresh**
- Every `dazzle s sync` reloads the browser automatically
- Use `--watch` for live development (edit → auto-sync → auto-reload)
