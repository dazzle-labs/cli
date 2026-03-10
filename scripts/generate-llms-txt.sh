#!/usr/bin/env bash
# Generate llms.txt — public-facing docs for the Dazzle CLI.
# Run from repo root: make llms-txt

set -euo pipefail
cd "$(dirname "$0")/.."

# Build and run the local CLI to capture help output
DAZZLE_BIN=$(mktemp)
trap 'rm -f "$DAZZLE_BIN"' EXIT
go build -o "$DAZZLE_BIN" ./cli/cmd/dazzle
CLI_HELP=$("$DAZZLE_BIN" --help 2>&1)

cat <<'EOF'
# Dazzle

> Cloud stages for AI agents and live streaming.
> https://stream.dazzle.fm

## Overview

Dazzle gives you cloud stages — isolated environments that render and broadcast your content. Control everything from the `dazzle` CLI.

Primary use cases: AI agents that need a persistent visual environment, live streaming to Twitch/YouTube/Kick via RTMP, and programmatic automation.

## Getting Started

### 1. Install the CLI

```bash
curl -sSL https://stream.dazzle.fm/install.sh | sh
```

Or `go install github.com/dazzle-labs/cli/cmd/dazzle@latest`, or download a binary from the [releases page](https://github.com/dazzle-labs/cli/releases). Source: https://github.com/dazzle-labs/cli

### 2. Authenticate

Sign up at https://stream.dazzle.fm, create an API key (Settings > API Keys), then:

```bash
dazzle login
# Paste your API key (dzl_...) when prompted
```

### 3. Create a stage and bring it up

```bash
dazzle s new my-stage
dazzle s up
```

If you have multiple stages, specify which one with `--stage` or `DAZZLE_STAGE`:

```bash
dazzle s ls                                # list all stages
dazzle s up --stage my-stage               # bring up a specific stage

# Or set for your session
export DAZZLE_STAGE=my-stage
dazzle s up
```

If you only have one stage, it's auto-selected.

### 4. Push content

Sync a local directory to your stage:

```bash
dazzle s sync ./my-app                  # one-time sync (auto-refreshes browser)
dazzle s sync ./my-app --watch          # watch for changes, re-sync, and auto-refresh
```

Every sync is a full snapshot — files deleted locally are automatically removed from the stage. The browser automatically reloads after every successful sync. The directory must contain an `index.html` entry point (customizable with `--entry`).

```bash
# Take a screenshot to verify
dazzle s ss -o preview.png

# Start streaming (requires a configured destination)
dazzle s bc on
```

### 5. Update content live

```bash
# Push live data without rewriting code
dazzle s ev e score '{"points": 42}'

# Manual browser reload (rarely needed — sync auto-refreshes)
dazzle s refresh
```

### 6. (Optional) Add a stream destination

```bash
dazzle dest new
```

Destinations are linked to stages and configured automatically in OBS.

## CLI Reference

```
EOF

echo "$CLI_HELP"

cat <<'EOF'
```

## Authentication

All requests require an API key in `dzl_<secret>` format, created via the dashboard (Settings > API Keys).

The CLI stores your key locally after `dazzle login`. For programmatic use, set:
```bash
export DAZZLE_API_KEY=dzl_your_key_here
```

## Content Authoring

Sync a local directory to your stage with `dazzle s sync`. The directory must contain an `index.html` entry point. The stage renders full-viewport with a black background. The browser automatically reloads after every successful sync.

You author standard HTML/CSS/JS — the stage serves your directory as static files. Use whatever framework or libraries you want (e.g. CDN links in your HTML, or bundled JS). To update content, edit files locally and re-sync (use `--watch` / `-w` for automatic re-sync on file changes).

### Persistence

`localStorage` is persisted across stage sessions. Your app can use it to store state that survives stage restarts (deactivate → activate). This makes it easy to build stateful applications — save your app state to `localStorage` and it will be there when the stage comes back up.

### Live events

Events are an async data channel — use them to send real-time data from external processes (subagents, APIs, webhooks, etc.) to your running page without re-syncing or reloading.

```bash
dazzle s ev e score '{"points": 42}'
```

Your page listens via:
```js
window.addEventListener('event', (e) => {
  const { event, data } = e.detail;
  if (event === 'score') el.textContent = data.points;
});
```

Events are dispatched as DOM `CustomEvent`s. For persistent state, use `localStorage` — it survives stage restarts.

## Content Performance Guide

Your content runs in a cloud browser captured at **1280×720 @ 30 fps**. The browser uses **software rendering** (SwiftShader WebGL on CPU) — there is no hardware GPU. About 50% of CPU is used by video capture/encoding at idle; your content gets the rest (~1.5–2 cores).

Run `dazzle guide` for the full guide. Key points below.

### Page Setup

Always use a full-viewport, no-scroll layout:
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
<body><!-- your content --></body>
</html>
```

For canvas, size to the window (`canvas.width = window.innerWidth`) — do NOT hardcode 1920×1080.

### What Works Well

- **CSS animations & transitions** — `@keyframes`, `transform`, `opacity`. Cheapest animation path.
- **Canvas 2D** — Drawing, compositing, simple particles. Great for dashboards and generative art.
- **Simple WebGL / Three.js** — Basic geometry, flat/phong materials: ~8–12% extra CPU. Fine for low-poly scenes.
- **DOM layouts** — Flexbox, Grid, SVG, text, images. All render well at 720p.
- **Web Audio** — Oscillators, buffers, Tone.js. Audio is captured by PulseAudio.
- **CDN libraries** — Three.js, D3, GSAP, p5.js, Tone.js all work via `<script>` tags.

### What to Avoid

- **Heavy WebGL** — Shadow maps, complex shaders, high-poly models, large particle systems (30–50% extra CPU). Simplify: bake lighting, keep draw calls under 50.
- **`backdrop-filter`** (blur, brightness) — Extremely expensive in software rendering. Use pre-blurred images instead.
- **High-frequency DOM updates** — RAF-speed React re-renders won't sync to 30 fps capture. Use CSS animations or throttled RAF.
- **Large assets** — Keep images under 2 MB. Use WebP/AVIF. No video files (you ARE the video).
- **Heavy `box-shadow`** — Multiple stacked shadows are expensive. Use 1–2 subtle shadows max.
- **Main thread blocking** — Long synchronous JS (large JSON parse, crypto) causes visible dropped frames.

### Design Tips for 720p

- **Text**: 16px+ body, 24px+ headings, high contrast, sans-serif. Avoid thin font weights (100–300).
- **Colors**: Bold, saturated colors. Subtle gradients may band in x264 encoding.
- **Layout**: Design for 16:9, no scrolling. Keep content 40px from edges (safe area).
- **Animation**: Target 30 fps or below. Ease-in-out curves look smoother than linear at low frame rates.

## Typical Workflow

```
1. dazzle s up                     → Bring up a stage
2. dazzle s sync ./my-app -w       → Sync a directory (watch + auto-refresh)
3. dazzle s ss                     → Verify output looks correct
4. dazzle s bc on                  → Go live on configured destination
5. (edit files locally)            → Changes auto-sync via --watch
6. dazzle s bc off                 → Stop streaming
7. dazzle s down                   → Shut down stage
```
EOF
