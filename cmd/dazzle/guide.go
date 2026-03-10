package main

import "fmt"

// GuideCmd handles `dazzle guide`.
type GuideCmd struct{}

const guideText = `# Dazzle Content Authoring Guide

Your content runs in a cloud browser captured at 1280×720 @ 30 fps. The browser
uses software rendering (SwiftShader WebGL) on shared CPU — there is no hardware
GPU. This guide helps you write content that looks great within these constraints.

## Environment at a Glance

  Resolution:    1280×720 (fixed)
  Frame rate:    30 fps (captured via x11grab → x264)
  Renderer:      ANGLE SwiftShader (software WebGL on CPU)
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
      html, body { width: 100%%; height: 100%%; overflow: hidden; background: #000; }
    </style>
  </head>
  <body>
    <!-- your content -->
  </body>
  </html>

For canvas-based content, size to the window:

  const W = canvas.width = window.innerWidth;   // 1280
  const H = canvas.height = window.innerHeight;  // 720

Do NOT hardcode 1920×1080 — the viewport is 1280×720.

## What Works Well

  CSS animations & transitions
    - @keyframes, transition, transform, opacity — all smooth at 30 fps
    - CSS is the cheapest way to animate; prefer it over JS when possible

  Canvas 2D
    - Drawing, compositing, and simple particle effects are efficient
    - Good for dashboards, visualizations, generative art, text rendering

  WebGL / Three.js (simple)
    - Basic geometry, flat/phong materials, simple shaders: 8–12%% extra CPU
    - Rotating cubes, low-poly scenes, 2D sprite rendering — all fine

  DOM-based layouts
    - Flexbox, Grid, absolute positioning — fast reflow
    - Text, SVG, images — render well at 720p
    - Styled components, Tailwind, vanilla CSS — all work

  Web Audio API
    - Oscillators, gain nodes, audio buffers — captured by PulseAudio
    - Good for music visualizers, sound effects, generative audio

  CDN libraries
    - Load via <script> or <link> from CDNs (unpkg, cdnjs, etc.)
    - Three.js, D3, GSAP, Tone.js, p5.js — all work

## What to Avoid or Use Carefully

  Heavy WebGL (30–50%% extra CPU)
    - Shadow maps, real-time reflections, high-poly models
    - Complex fragment shaders, GPGPU compute via WebGL
    - Large particle systems (>1000 particles with physics)
    → Simplify: bake lighting, use low-poly, keep draw calls under 50

  backdrop-filter (blur, brightness, etc.)
    - Very expensive in software rendering — avoid entirely
    - Use pre-blurred background images or solid overlays instead

  High-frequency DOM updates
    - Avoid RAF-speed React/state re-renders (won't sync to 30 fps capture)
    - Use CSS animations or requestAnimationFrame with manual throttling
    - Batch DOM writes; avoid layout thrashing (read then write, not interleaved)

  Large assets
    - Keep images under 2 MB each; use compressed formats (WebP, AVIF)
    - Sprite sheets over many individual images
    - Avoid loading video files — you ARE the video output

  box-shadow with large spread/blur
    - Multiple stacked shadows are expensive in software rendering
    - Use 1–2 subtle shadows max, or fake with border/gradient

  Main thread blocking
    - No long-running synchronous JS (large JSON parse, crypto, etc.)
    - Dropped frames are visible in the stream — keep the main thread clear

## Design Tips for 720p Streaming

  Text
    - Minimum 16px for body text, 24px+ for headings
    - High contrast: light text on dark background (or vice versa)
    - Sans-serif fonts render more cleanly at this resolution
    - Google Fonts via <link> work fine
    - Avoid thin font weights (100–300) — they disappear at 720p

  Colors & contrast
    - Dark backgrounds (#000 or near-black) are the stage default
    - Use bold, saturated colors — subtlety gets lost in compression
    - Avoid fine gradients that may band in x264 encoding

  Layout
    - Design for 16:9 (1280×720) — no scrolling, no overflow
    - Keep important content away from edges (safe area: ~40px inset)
    - Larger UI elements read better on stream than small detailed ones

  Animation
    - Target 30 fps or below — anything faster is wasted (capture is 30 fps)
    - Ease-in-out curves look smoother than linear at low frame rates
    - Avoid very fast motion that causes x264 motion blur artifacts

## Performance Monitoring

Take screenshots to verify your content looks correct:

  dazzle s ss -o check.png

If animations feel sluggish, simplify your rendering. The CPU budget
after capture/encode overhead is roughly 1.5–2 cores for your content.

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
    - Use --watch for live development (edit → auto-sync → auto-reload)
`

func (c *GuideCmd) Run(ctx *Context) error {
	fmt.Print(guideText)
	return nil
}
