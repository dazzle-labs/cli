#!/usr/bin/env bash
# Generate llms.txt — public-facing docs for the Dazzle CLI.
# Run from repo root: make llms-txt

set -euo pipefail
cd "$(dirname "$0")/.."

# Build and run the local CLI to capture help output
DAZZLE_BIN=$(mktemp)
trap 'rm -f "$DAZZLE_BIN"' EXIT
go build -o "$DAZZLE_BIN" ./dazzle-cli/cmd/dazzle
CLI_HELP=$("$DAZZLE_BIN" --help 2>&1)

cat <<'EOF'
# Dazzle

> Cloud stages for AI agents and live streaming.
> https://stream.dazzle.fm

## Overview

Dazzle gives you cloud stages — isolated environments with a full rendering engine, OBS for streaming, and hot-reloading script support. Control everything from the `dazzle` CLI.

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
# Paste your API key (bstr_...) when prompted
```

### 3. Create and activate a stage

```bash
dazzle s new my-stage
dazzle s up
```

If you have multiple stages, specify which one with `-s` or set a default:

```bash
dazzle s ls                          # list all stages
dazzle s up -s my-stage              # activate a specific stage
dazzle s sc set app.jsx -s my-stage  # target a specific stage
dazzle s default my-stage             # set default for all commands
```

### 4. Push content and go live

```bash
# Set a script (JS or JSX, hot-swapped via HMR)
dazzle s sc set ./my-overlay.jsx

# Take a screenshot to verify
dazzle s ss -o preview.png

# Start streaming (requires a configured destination)
dazzle s live on
```

### 5. Update content live

```bash
# Edit in-place (find & replace)
dazzle s sc edit --old "Hello" --new "World"

# Push live data without rewriting the script
dazzle s ev e score '{"points": 42}'
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

All requests require an API key in `bstr_<secret>` format, created via the dashboard (Settings > API Keys).

The CLI stores your key locally after `dazzle login`. For programmatic use, set:
```bash
export DAZZLE_API_KEY=bstr_your_key_here
```

## Scripting

`dazzle s sc set` pushes JavaScript or JSX to your stage. The page is full-viewport with a black background. Changes are hot-swapped with zero page reloads.

Two modes:
1. **Vanilla JS** — create DOM elements / canvas and append to `document.body`
2. **React JSX** — define an `App` component and it will be auto-mounted:
   ```jsx
   const App = () => <div>Hello</div>;
   ```
   Do NOT call `createRoot` or `ReactDOM.render` — the runtime auto-mounts your App.

Available globals (no imports needed):
```
React, useState, useEffect, useRef, useMemo, useCallback, useReducer, Fragment,
useContext, useLayoutEffect, useImperativeHandle, useDebugValue,
useDeferredValue, useTransition, useId, useSyncExternalStore,
createContext, forwardRef, memo, lazy, Suspense
createPortal (from react-dom)
create, persist (from zustand — use for persistent state via localStorage)
```

Tailwind CSS v4 utility classes work in `className` (e.g. `"text-4xl font-bold text-white"`).

### Live events

Use `dazzle s ev e` to push data to a running script without rewriting it:

```bash
dazzle s ev e score '{"points": 42}'
```

Your script listens via:
```js
window.addEventListener('event', (e) => {
  const { event, data } = e.detail;
  if (event === 'score') el.textContent = data.points;
});
```

Read `window.__state` at any time for accumulated state from all prior events. An `__init` event fires on script load if prior state exists.

## Typical Workflow

```
1. dazzle s up                → Activate a stage
2. dazzle s sc set app.jsx    → Render content (hot-swapped via HMR)
3. dazzle s ss                → Verify output looks correct
4. dazzle s live on          → Go live on configured destination
5. dazzle s sc edit / s ev e  → Update content live
6. dazzle s live off           → Stop streaming
7. dazzle s down              → Deactivate stage
```
EOF
