# Dazzle Content Authoring Guide

Your content runs in a cloud browser captured at 1280x720 @ 30 fps and streamed
to platforms like Twitch, Kick, and YouTube. This guide helps you write content
that looks great on stream.

Dazzle stages come in two tiers:

- **GPU stages** — NVIDIA RTX with hardware-accelerated WebGL and video encoding.
  Shaders, raymarching, complex post-processing — all 30 FPS.
- **CPU stages** — Software-rendered OpenGL on shared CPU. Lighter content only.

Most of this guide applies to both. Sections marked **(CPU only)** note
constraints that don't apply on GPU.

## Environment at a Glance

| Setting     | GPU Stage                                      | CPU Stage                          |
|-------------|------------------------------------------------|------------------------------------|
| Resolution  | 1280x720 (fixed)                               | 1280x720 (fixed)                   |
| Frame rate  | 30 fps rendering + capture                     | 30 fps rendering + capture         |
| Renderer    | NVIDIA RTX (hardware WebGL via ANGLE)           | Software OpenGL (no hardware GPU)  |
| Encoder     | Vulkan Video / NVENC, CBR 2500k                | x264 (CPU), CBR 2500k             |
| Browser     | Chrome, kiosk mode, full viewport               | Chrome, kiosk mode, full viewport  |
| Audio       | PulseAudio capture (Web Audio API works)        | PulseAudio capture                 |
| Persistence | localStorage and IndexedDB survive restarts     | Same                               |

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

## Prefer Declarative Over Imperative

Write content as **declarative HTML/CSS/SVG** rather than imperative canvas
drawing code whenever possible. Declarative approaches are:

- **Easier to maintain** — structure is visible in the markup
- **Better for streaming** — CSS animations are GPU-composited and silky smooth
- **More resilient** — no frame-loop bugs, no state management issues
- **Easier to update** — change a CSS variable, not a draw function

**Good: declarative**
```html
<div class="particle" style="--x: 50%; --y: 30%; --hue: 200;"></div>
<style>
  .particle {
    position: absolute;
    left: var(--x); top: var(--y);
    background: hsl(var(--hue), 80%, 60%);
    animation: float 3s ease-in-out infinite;
  }
</style>
```

**Avoid: imperative canvas for things CSS can do**
```js
// Don't do this for simple animations
function draw() {
  ctx.clearRect(0, 0, W, H);
  particles.forEach(p => {
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, 4, 4);
    p.y += Math.sin(p.t) * 0.5;
  });
  requestAnimationFrame(draw);
}
```

Use canvas/WebGL when you genuinely need it: complex generative art, shader
effects, data visualizations with thousands of data points, or anything that
requires per-pixel control.

## What Works Well

**CSS animations & transitions** (both tiers)
- `@keyframes`, `transition`, `transform`, `opacity` — all smooth at 30 fps
- CSS is the cheapest way to animate; prefer it over JS when possible

**SVG** (both tiers)
- Vector graphics scale perfectly and animate smoothly via CSS
- Good for logos, icons, diagrams, and data visualizations

**Canvas 2D** (both tiers)
- Drawing, compositing, particle effects — efficient even with 1000+ particles
- Good for dashboards, visualizations, generative art, text rendering

**DOM-heavy animation** (both tiers)
- 200+ elements repositioned every frame via JS — still 59 fps

**WebGL shaders** (GPU: unlimited | CPU: geometry only)
- **GPU stages**: Full fragment shader support — raymarching, SDF, FBM noise,
  multi-pass rendering, bloom, post-processing — all 30 FPS. Go wild.
- **CPU stages**: Geometry-based WebGL (500K+ triangles with per-pixel lighting)
  works at 30 fps. But fragment-heavy shaders (noise, raymarching) drop to
  1-11 fps. Use mesh complexity instead of shader complexity.

**Web Audio API** (both tiers)
- Oscillators, gain nodes, audio buffers — captured by PulseAudio
- Good for music visualizers, sound effects, generative audio

**CDN libraries** (both tiers)
- Load via `<script>` or `<link>` from CDNs (unpkg, cdnjs, etc.)
- Three.js, D3, GSAP, Tone.js, p5.js — all work

## Performance Tiers

### GPU stages

Almost everything runs at 30 FPS. The bottleneck is JavaScript, not rendering:

| Tier | What | FPS |
|------|-------|-----|
| Smooth (30) | Everything: CSS, Canvas 2D, WebGL (any shader complexity), SVG, DOM | 30 |
| Good (25+) | Heavy JS computation + rendering, large DOM trees (1000+ nodes) | 25-30 |
| Risky (<30) | Main thread blocking (large JSON parse, crypto), layout thrashing | varies |

### CPU stages

Rendering is the bottleneck. Shader complexity is expensive:

| Tier | What | FPS |
|------|-------|-----|
| Smooth (30) | HTML/CSS, Canvas 2D (1000 particles), DOM animation, WebGL geometry (500K+ tris) | 30 |
| Good (30+) | Simple full-screen SDF raymarcher (48 steps, no noise), `backdrop-filter` with few panels | 30-36 |
| Too heavy (<15) | Fragment shaders with noise, multi-pass rendering, complex raymarching | 1-11 |

## What to Avoid

**Large assets** (both tiers)
- Keep images under 2 MB each; use compressed formats (WebP, AVIF)
- Sprite sheets over many individual images
- Avoid loading video files — you ARE the video output

**Main thread blocking** (both tiers)
- No long-running synchronous JS (large JSON parse, crypto, etc.)
- Dropped frames are visible in the stream — keep the main thread clear
- Use Web Workers for heavy computation

**Unnecessary canvas when CSS suffices** (both tiers)
- Animating colored boxes? Use `div` + CSS transforms
- Progress bars, counters, text overlays? Use HTML elements
- Particle effects with <50 particles? CSS animations work fine
- Save canvas/WebGL for when you need per-pixel control

**Fragment-heavy shaders (CPU only)**
- Per-pixel noise functions, raymarching, multi-pass rendering
- Even 2-octave noise in a raymarcher drops to ~11 fps on CPU
- On GPU stages these are fine — no restriction

**`backdrop-filter` (CPU only)**
- Very expensive in software rendering
- Use pre-blurred background images or solid overlays instead
- On GPU stages `backdrop-filter` works fine

**`box-shadow` with large spread/blur (CPU only)**
- Multiple stacked shadows are expensive in software rendering
- Use 1-2 subtle shadows max, or fake with border/gradient

## Design Tips for 720p Streaming

**Text**
- Minimum 16px for body text, 24px+ for headings
- High contrast: light text on dark background (or vice versa)
- Sans-serif fonts render more cleanly at this resolution
- Google Fonts via `<link>` work fine
- Avoid thin font weights (100-300) — they disappear at 720p

**Colors & contrast**
- Dark backgrounds (`#000` or near-black) are the stage default
- Use bold, saturated colors — subtlety gets lost in compression
- Avoid fine gradients that may band in video encoding

**Layout**
- Design for 16:9 (1280x720) — no scrolling, no overflow
- Keep important content away from edges (safe area: ~40px inset)
- Larger UI elements read better on stream than small detailed ones

**Animation**
- Target 30 fps or below for animation design — capture is 30 fps
- Ease-in-out curves look smoother than linear at low frame rates
- Avoid very fast motion that causes compression artifacts

## Performance Monitoring

Check your stage's live rendering performance:

```
dazzle s stats
```

Output:
```
Stage FPS:       30.0
Broadcast FPS:   30.0
Dropped Frames:  0 (0 last 60s)
Data:            142.50 MB
Broadcasting:    yes
Uptime:          2h 15m
```

- **Stage FPS** — how fast Chrome is rendering your content. On GPU stages this
  should be at 30. Below 30, your content needs to be simplified
  (or moved to a GPU stage if on CPU).
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
- Listen: `window.addEventListener('<name>', e => e.detail)`
- Good for scores, alerts, chat messages, external data feeds

**Sync auto-refresh**
- Every `dazzle s sync` reloads the browser automatically
- Use `--watch` for live development (edit -> auto-sync -> auto-reload)
