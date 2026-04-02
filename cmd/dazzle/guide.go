package main

import (
	"fmt"
	"io"
	"net/http"
	"time"
)

// GuideCmd handles `dazzle guide`.
type GuideCmd struct{}

const guideURL = "https://dazzle.fm/llms-full.txt"

func (c *GuideCmd) Run(ctx *Context) error {
	// Try fetching the latest guide from the server
	httpClient := &http.Client{Timeout: 3 * time.Second}
	resp, err := httpClient.Get(guideURL)
	if err == nil && resp.StatusCode == http.StatusOK {
		defer resp.Body.Close() //nolint:errcheck
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

Your content runs in a cloud browser captured at 1280x720 @ 30 fps and streamed
to platforms like Twitch and Kick. Dazzle stages come in two tiers:

  GPU stages — NVIDIA RTX hardware WebGL. Shaders, raymarching, post-processing,
               complex fragment work — all 30 FPS. Go wild.
  CPU stages — Software-rendered OpenGL. Geometry-based WebGL, Canvas 2D, CSS,
               DOM animation all run at 30 FPS. Fragment-heavy shaders are slower.

## What You Can Build

Dazzle stages are full Chrome browsers. Anything that runs in a browser works:

  WebGL / Three.js / p5.js
    - 500K+ triangle scenes with lighting — 30 fps on both tiers
    - Fragment shaders, raymarching, FBM noise — 30 fps on GPU stages
    - Three.js, p5.js, custom WebGL, Babylon.js — all work great
    - Load from CDN: <script src="https://unpkg.com/three@latest/...">

  Canvas 2D
    - Particle systems (1000+), generative art, data viz, text rendering
    - Compositing, gradients, image manipulation — all smooth

  CSS / DOM animation
    - @keyframes, transforms, transitions — GPU-composited and smooth
    - 200+ animated DOM elements — still 30 fps
    - SVG animations via CSS work great

  Audio
    - Web Audio API: oscillators, buffers, effects — captured to stream
    - Tone.js, Howler.js — load from CDN

  External data
    - fetch() any API — relaxed CORS, no cross-origin errors
    - WebSockets, Server-Sent Events, REST APIs — all work
    - Real-time data via events: dazzle s ev e <name> '<json>'

  CDN libraries
    - Three.js, D3, GSAP, Tone.js, p5.js, Anime.js, PixiJS — all work
    - Google Fonts via <link> — fine

## Page Setup

Full-viewport, no-scroll layout:

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

For canvas, size to the window (do NOT hardcode 1920x1080):

  const W = canvas.width = window.innerWidth;   // 1280
  const H = canvas.height = window.innerHeight;  // 720

Use vw/vh for sizing so layouts adapt if resolution changes:

  font-size: 2vw;  padding: 1.5vh 2vw;  gap: 0.8vw;

## GPU vs CPU Notes

On GPU stages, everything is fast — shaders, post-processing, backdrop-filter,
box-shadow, complex fragment work. No restrictions.

On CPU stages, per-pixel fragment work is the bottleneck:
  - Geometry-based WebGL (500K+ tris, Phong lighting) — 30 fps, great
  - Fragment shaders with noise or raymarching — slower (1-15 fps)
  - backdrop-filter and heavy box-shadow — use sparingly
  - Use "dazzle s stats" to check — if Stage FPS < 30, simplify

## Design Tips for 720p

  - Minimum 16px body text, 24px+ headings; sans-serif fonts are clearest
  - High contrast, bold saturated colors — subtlety gets lost in compression
  - Design for 16:9, no scrolling — keep content away from edges (~40px safe area)
  - Thin font weights (100-300) disappear at 720p
  - Avoid fine gradients that band in video encoding

## Persistence & Live Updates

  localStorage — persisted to cloud storage, survives stage restarts
  Events       — push data: dazzle s ev e <name> '<json>'
                  listen:   window.addEventListener('<name>', e => e.detail)
  Sync         — every "dazzle s sync" reloads the browser automatically
                  use --watch for live dev (edit -> auto-sync -> auto-reload)

## Monitoring

  dazzle s stats       # live FPS, broadcast status, dropped frames
  dazzle s ss -o x.png # screenshot to verify content
`
