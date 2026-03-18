package main

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

// GuideCmd handles `dazzle guide`.
type GuideCmd struct{}

const guideURL = "https://dazzle.fm/guide.md"

func (c *GuideCmd) Run(ctx *Context) error {
	// Try fetching the latest guide from the server
	httpClient := &http.Client{Timeout: 3 * time.Second}
	resp, err := httpClient.Get(guideURL)
	if err == nil && resp.StatusCode == http.StatusOK {
		defer resp.Body.Close()
		body, err := io.ReadAll(resp.Body)
		if err == nil && len(body) > 0 {
			fmt.Print(string(body))
			return nil
		}
	}

	// Fall back to embedded guide
	fmt.Print(guideText)
	return nil
}

// guideText is the embedded fallback guide, used when the server is unreachable.
const guideText = `# Dazzle Content Authoring Guide

Your content runs in a cloud browser captured at 1280x720 @ 30 fps. There is no
hardware GPU — rendering is done in software on shared CPU. This guide helps you
write content that looks great within these constraints.

## Environment at a Glance

  Resolution:    1280x720 (fixed)
  Frame rate:    30 fps (captured via x11grab -> x264)
  Renderer:      Software OpenGL (no hardware GPU)
  CPU budget:    ~50%% used by capture/encode at idle; your content gets the rest
  Browser:       Headless Chrome, kiosk mode, full viewport
  Audio:         PulseAudio capture (Web Audio API works)
  Persistence:   localStorage and IndexedDB survive stage restarts

## Page Setup

Always start with a full-viewport, no-scroll layout:

  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { width: 100vw; height: 100vh; overflow: hidden; background: #000; }
    </style>
  </head>
  <body>
    <!-- your content -->
  </body>
  </html>

For canvas-based content, size to the window:

  const W = canvas.width = window.innerWidth;   // 1280
  const H = canvas.height = window.innerHeight;  // 720

Do NOT hardcode 1920x1080 — the viewport is 1280x720.

## Use Viewport-Relative Units

Always size and position elements with vw/vh (viewport-width / viewport-height)
instead of fixed px values. The stage viewport is 1280x720 today but may change,
and hardcoded pixel values will clip or misalign if the resolution shifts.

  Good:  font-size: 2vw;   padding: 1.5vh 2vw;   gap: 0.8vw;
  Bad:   font-size: 28px;  padding: 16px 24px;    gap: 12px;

Rules of thumb:
  - 1vw ≈ 12.8px at 1280 wide  — use vw for horizontal sizing, font sizes, gaps
  - 1vh ≈ 7.2px at 720 tall    — use vh for vertical spacing and padding
  - Use %% inside flex/grid children when sizing relative to a parent container
  - Never set body/html to a fixed pixel width — use 100vw / 100vh
  - For canvas elements, read window.innerWidth / innerHeight at runtime

This ensures your layout fills the viewport correctly regardless of the exact
resolution the stage is running at.

## What Works Well (60 FPS)

  CSS animations & transitions
    - @keyframes, transition, transform, opacity — all smooth at 60 fps
    - CSS is the cheapest way to animate; prefer it over JS when possible

  Canvas 2D
    - Drawing, compositing, particle effects — efficient even with 1000+ particles
    - Good for dashboards, visualizations, generative art, text rendering

  DOM-heavy animation
    - 200+ elements repositioned every frame via JS — still 59 fps
    - requestAnimationFrame-driven layouts work well

  WebGL geometry
    - 500K+ triangles with per-pixel Phong lighting — still 60 fps
    - Three.js, p5.js, custom WebGL — all perform well
    - Use mesh complexity (more triangles) instead of shader complexity

  Web Audio API
    - Oscillators, gain nodes, audio buffers — captured by PulseAudio
    - Good for music visualizers, sound effects, generative audio

  CDN libraries
    - Load via <script> or <link> from CDNs (unpkg, cdnjs, etc.)
    - Three.js, D3, GSAP, Tone.js, p5.js — all work

## Performance Tiers

  Smooth (60 fps):   HTML/CSS, Canvas 2D, DOM, WebGL geometry (even 500K+ tris)
  Good (30+ fps):    Simple SDF raymarcher (48 steps, no noise), backdrop-filter
  Too heavy (<15):   Fragment shaders with noise, multi-pass rendering

  Geometry-based WebGL is the sweet spot — even 100 draw calls with 512K
  total triangles runs at 60 fps. The bottleneck is per-pixel fragment work.
  Use "dazzle s stats" to monitor.

  Avoid:
    - Fragment shaders with noise — even 2-octave noise drops to ~11 fps
    - Multi-pass rendering — render-to-texture + post-process costs ~11 fps
    - Complex raymarching — multi-octave FBM terrain drops to ~1 fps
    - backdrop-filter — borderline (~30 fps), avoid stacking panels
    - Monitor with "dazzle s stats" — if Stage FPS < 30, simplify

## What to Avoid

  backdrop-filter (blur, brightness, etc.)
    - Very expensive in software rendering — avoid entirely
    - Use pre-blurred background images or solid overlays instead

  Large assets
    - Keep images under 2 MB each; use compressed formats (WebP, AVIF)
    - Sprite sheets over many individual images
    - Avoid loading video files — you ARE the video output

  box-shadow with large spread/blur
    - Multiple stacked shadows are expensive in software rendering
    - Use 1-2 subtle shadows max, or fake with border/gradient

  Main thread blocking
    - No long-running synchronous JS (large JSON parse, crypto, etc.)
    - Dropped frames are visible in the stream — keep the main thread clear

## Design Tips for 720p Streaming

  Text
    - Minimum 16px for body text, 24px+ for headings
    - High contrast: light text on dark background (or vice versa)
    - Sans-serif fonts render more cleanly at this resolution
    - Google Fonts via <link> work fine
    - Avoid thin font weights (100-300) — they disappear at 720p

  Colors & contrast
    - Dark backgrounds (#000 or near-black) are the stage default
    - Use bold, saturated colors — subtlety gets lost in compression
    - Avoid fine gradients that may band in x264 encoding

  Layout
    - Design for 16:9 (1280x720) — no scrolling, no overflow
    - Use vw/vh units everywhere — never hardcode pixel dimensions
    - Keep important content away from edges (safe area: ~2vw / ~2vh inset)
    - Larger UI elements read better on stream than small detailed ones

  Animation
    - Target 30 fps or below — anything faster is wasted (capture is 30 fps)
    - Ease-in-out curves look smoother than linear at low frame rates
    - Avoid very fast motion that causes x264 motion blur artifacts

## Performance Monitoring

Check your stage's live rendering FPS:

  dazzle s stats

This shows both Stage FPS (browser rendering speed) and Broadcast FPS
(encoder output). If Stage FPS drops below 30, your content is too heavy
for the software renderer — simplify your content.

Take screenshots to verify your content looks correct:

  dazzle s ss -o check.png

## Persistence & Live Updates

  localStorage
    - Persisted to cloud storage; survives stage restarts
    - Use for app state, user preferences, accumulated data

  Events (real-time data channel)
    - Push data without reloading: dazzle s ev e <name> '<json>'
    - Listen: window.addEventListener('event', e => { ... })
    - Good for scores, alerts, chat messages, external data feeds

  Sync auto-refresh
    - Every "dazzle s sync" reloads the browser automatically
    - Use --watch for live development (edit -> auto-sync -> auto-reload)
`
