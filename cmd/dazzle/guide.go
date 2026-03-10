package main

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

// GuideCmd handles `dazzle guide`.
type GuideCmd struct{}

const guideURL = "https://stream.dazzle.fm/guide.md"

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

Your content runs in a cloud browser captured at 1280x720 @ 30 fps. The browser
uses software rendering (SwiftShader WebGL) on shared CPU — there is no hardware
GPU. This guide helps you write content that looks great within these constraints.

## Environment at a Glance

  Resolution:    1280x720 (fixed)
  Frame rate:    30 fps (captured via x11grab -> x264)
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

Do NOT hardcode 1920x1080 — the viewport is 1280x720.

## What Works Well (60 FPS)

  CSS animations & transitions
    - @keyframes, transition, transform, opacity — all smooth at 60 fps
    - CSS is the cheapest way to animate; prefer it over JS when possible

  Canvas 2D
    - Drawing, compositing, particle effects — efficient even with 300+ particles
    - Good for dashboards, visualizations, generative art, text rendering

  DOM-heavy animation
    - 200+ elements repositioned every frame via JS — still 59 fps
    - requestAnimationFrame-driven layouts work well

  WebGL geometry (up to ~5000 triangles)
    - Basic geometry, flat/phong/PBR materials on meshes — full 60 fps
    - Rotating cubes, icospheres, low-poly scenes, 2D sprite rendering
    - Per-pixel Phong lighting on 5120-triangle meshes: 60 fps

  Web Audio API
    - Oscillators, gain nodes, audio buffers — captured by PulseAudio
    - Good for music visualizers, sound effects, generative audio

  CDN libraries
    - Load via <script> or <link> from CDNs (unpkg, cdnjs, etc.)
    - Three.js, D3, GSAP, Tone.js, p5.js — all work

## The SwiftShader Cliff: Geometry vs Fragment Shaders

SwiftShader (the CPU-based WebGL renderer) has a hard performance cliff:

  Geometry-based rendering     ->  60 fps  (vertex shaders, mesh lighting)
  Full-screen fragment loops   ->  1-5 fps (raymarching, SDF, noise)

This is NOT a gradual slope. Even the simplest possible full-screen raymarcher
(single sphere, 48 march steps, no noise) drops to ~4 fps. The bottleneck is
per-pixel loop iterations across all 921,600 pixels (1280x720) in software.

  What's fast:
    - Mesh-based WebGL with any material (flat, Phong, PBR)
    - Vertex-driven effects (displacement maps, morph targets)
    - Simple fragment shaders without loops (color grading, UV effects)
    - Instanced rendering with many objects

  What's slow (avoid):
    - Raymarching / signed distance fields (any step count)
    - Fractal noise (FBM) computed per-pixel
    - Volumetric effects (clouds, fog, god rays via ray stepping)
    - Multi-pass rendering (bloom, blur, post-processing)
    - Path tracing / global illumination

  If you need complex visuals:
    - Bake effects into textures or meshes offline
    - Use pre-rendered video textures for backgrounds
    - Replace raymarched shapes with actual geometry
    - Move noise to vertex shaders or use texture-based noise

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
    - Keep important content away from edges (safe area: ~40px inset)
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
for the software renderer — simplify your shaders or switch to geometry.

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
