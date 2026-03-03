# Browser Streamer — Documentation Rescan Summary
**Scan Date:** 2026-03-03 | **Baseline:** 2026-03-02

---

## Overview

A comprehensive rescan of the browser-streamer project revealed **13 commits** since March 2, with **11 key architecture and dependency changes** across all three components. The project has undergone significant architectural improvements to support hot-reload content development with React/Zustand/Tailwind via Vite HMR.

**Last Major Update:** 2026-03-03 14:09:48 (removal of dead k8s manifests and legacy HTML)

---

## Component Status

### Session Manager (Go)
- **Status:** Actively developed
- **Last Modified:** 2026-03-03 11:00:16
- **Go Version:** 1.24.0
- **Key Updates:** 
  - MCP tools renamed (start/stop/status)
  - Endpoints service added for persistent configuration
  - emit_event tool for Elm-style state management

### Server (Node.js)
- **Status:** Actively developed
- **Last Modified:** 2026-03-03 14:06:54
- **Latest Additions:** prelude.js, vite-init.mjs
- **Key Dependencies Added:** React 19.1.0, Zustand 5.0.5, Tailwind 4.1.4

### Dashboard (React/TypeScript)
- **Status:** Actively developed
- **Last Modified:** 2026-03-03 07:26:51
- **Latest Changes:** UI terminology alignment (sessions → stages)

---

## Major Changes Since March 2

### 1. OBS Screen Capture Architecture (Critical)
**Date:** 2026-03-03 12:08:55
- **Change:** browser_source → xshm_input (Linux X11 screen capture)
- **Impact:** Decoupled OBS from Chrome, improved stability
- **Files:** streamer/docker/entrypoint.sh, streamer/index.js, control-plane/mcp.go

### 2. React/Zustand/Tailwind Added to Content Pipeline (High)
**Date:** 2026-03-03 13:29:47
- **New Files:** prelude.js, vite-init.mjs
- **New Dependencies:** React 19.1.0, Zustand 5.0.5, Tailwind 4.1.4, Vite 6.2.0
- **Impact:** Rich interactive content with hot-reload support

### 3. Terminology Change: Sessions → Stages (High)
**Date:** 2026-03-03 11:03:06
- **Scope:** control-plane/main.go, mcp.go, 10+ dashboard components
- **Impact:** Clearer MCP stage lifecycle naming
- **Breaking Change:** External documentation must update

### 4. MCP Tools Renamed (High)
**Date:** 2026-03-03 11:25:10
- **Changes:** create → start, destroy → stop
- **New Terminology:** active/inactive instead of running/stopped
- **Breaking Change:** External code must use new names

### 5. Elm-Style State Management (Medium)
**Date:** 2026-03-03 10:29:48
- **New Tool:** emit_event for WebSocket-based state updates
- **Pattern:** Decoupled view from state, event-driven updates via Vite HMR

### 6. New Endpoints Table (Medium)
**Date:** 2026-02-16 (migration 003)
- **Purpose:** Persistent MCP endpoint configuration per user
- **Schema:** id (UUID), user_id, name, created_at

### 7. Docker Base Image Upgrade (Medium)
**Date:** 2026-03-03 07:47:38
- **Change:** Ubuntu 22.04 → 24.04 (in `streamer/docker/Dockerfile`)
- **New Stack:** Node.js 20, updated system libraries

### 8. OBS GPU Crash Fix (Medium)
**Date:** 2026-03-03 11:03:06
- **Solution:** Software rendering via LIBGL_ALWAYS_SOFTWARE=1 + GALLIUM_DRIVER=llvmpipe
- **Impact:** Stable OBS startup in headless Xvfb

---

## Database Schema Changes

**New Table (Migration 003):**
```sql
CREATE TABLE endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Minor Updates (Migration 002):**
- Made `direct_port` nullable in `session_log` table

---

## Key Dependencies Status

| Component | Framework | Version | Status |
|-----------|-----------|---------|--------|
| control-plane | Go | 1.24.0 | ✓ Updated |
| control-plane | Connect RPC | v1.19.1 | ✓ |
| control-plane | MCP SDK | v0.44.1 | ✓ |
| server | Express | ^4.18.2 | ✓ |
| server | React | ^19.1.0 | ✓ New |
| server | Vite | ^6.2.0 | ✓ New |
| server | Zustand | ^5.0.5 | ✓ New |
| server | Tailwind | ^4.1.4 | ✓ New |
| dashboard | React | ^19.0.0 | ✓ |
| dashboard | Tailwind | ^4.2.1 | ✓ |

---

## MCP Tools (9 Total)

| Tool | Status | Change |
|------|--------|--------|
| start | Active | Renamed from create |
| stop | Active | Renamed from destroy |
| status | Active | Unchanged |
| set_script | Active | Enhanced docs |
| get_script | Active | Unchanged |
| edit_script | Active | Unchanged |
| emit_event | New | Added 2026-03-03 |
| screenshot | Active | Unchanged |
| gobs | Active | Unchanged |

---

## Breaking Changes

1. **MCP Tool Names** (date: 2026-03-03 11:25:10)
   - create → start
   - destroy → stop
   - **Impact:** External scripts/docs must update

2. **Terminology** (date: 2026-03-03 11:03:06)
   - "sessions" → "stages"
   - **Impact:** Documentation and external references need updates

---

## Architecture Highlights

### Content Rendering Pipeline
```
Client → Session Manager → Pod Creation → 
  Xvfb (virtual display) +
  Chrome (kiosk mode, CDP on 9222) +
  OBS Studio (xshm_input screen capture) +
  Node.js Server (Express + Vite HMR) →
  HLS preview (ffmpeg) / Streaming output
```

### State Management (New)
```
emit_event (WebSocket) → window.__state (persisted) → 
  window.dispatchEvent('event') → React/JS listeners
```

### Hot Reload Support
- Vite dev server in middleware mode
- Prelude.js exposes React, Zustand, Tailwind as globals
- shell.html wraps user code with HMR cleanup
- state persists across reloads in window.__state

---

## Documentation Update Recommendations

**Files Requiring Updates:**

1. **CLAUDE.md** — Update with new terminology and OBS architecture
2. **docs/architecture-streamer.md** — Document xshm_input, Vite HMR, state management
3. **docs/architecture-control-plane.md** — Update MCP tools reference
4. **docs/integration-architecture.md** — Document React/Zustand/Tailwind integration
5. **docs/deployment-guide.md** — Update Docker base image and PulseAudio config (in `streamer/docker/`)
6. **docs/data-models.md** — Document new endpoints table
7. **docs/api-contracts.md** — Add EndpointService details
8. **Documentation paths** — Update all `docker/`, `dashboard/`, and `server/` references to new locations

---

## Cleanup Actions Completed

- Removed orphaned k8s manifests (browserless-*.yaml)
- Deleted obsolete HTML files (example.html, viewer.html)
- **Date:** 2026-03-03 14:09:48

---

## Next Steps

1. Update CLAUDE.md with new terminology and architecture details
2. Enhance docs with React/Zustand/Tailwind examples
3. Document emit_event pattern for state-driven content
4. Add integration test suite (currently noted as missing)
5. Update external documentation/APIs that reference old terminology

---

## Full Details

For comprehensive analysis including:
- Detailed commit history
- Complete file-by-file changes
- Migration schemas
- Service definitions
- All MCP tool signatures

See: `/Users/johnsabath/projects/browser-streamer/docs/rescan-findings.json`
