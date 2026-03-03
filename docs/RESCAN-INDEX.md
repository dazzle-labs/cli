# Browser Streamer — March 3, 2026 Documentation Rescan

This directory contains the complete results of the full documentation rescan executed on **2026-03-03**.

## Rescan Reports

### 1. Summary Report (Human-Readable)
**File:** `rescan-summary.md` (216 lines)

Quick reference guide covering:
- Component status overview
- 8 major changes since March 2
- Breaking changes summary
- Architecture highlights
- Documentation update recommendations
- Next steps

**Start here** if you want a quick overview of what changed.

### 2. Detailed Findings (JSON)
**File:** `rescan-findings.json` (632 lines, 21 KB)

Comprehensive machine-readable analysis including:
- Full git commit history with impact analysis
- Per-component dependency inventory
- Database migration details
- MCP tools reference (all 9 tools documented)
- Service definitions (5 RPC services)
- Breaking changes with severity levels
- Integration points between components
- Detailed recommendations for documentation updates

**Use this** for integration testing, automation, or detailed audit.

---

## Quick Facts

| Metric | Value |
|--------|-------|
| **Scan Date** | 2026-03-03 14:15:00 UTC |
| **Baseline Date** | 2026-03-02 00:00:00 UTC |
| **Commits Analyzed** | 13 |
| **Components Modified** | 3 (control-plane, server, dashboard) |
| **Key Changes Detected** | 11 |
| **Breaking Changes** | 2 |
| **New Dependencies** | 4 (React, Vite, Zustand, Tailwind in server) |
| **New Database Table** | 1 (endpoints) |
| **Last Major Update** | 2026-03-03 14:09:48 (cleanup commit) |

---

## Critical Changes

### 1. Screen Capture Architecture
- **Old:** OBS browser_source embedding Chrome
- **New:** xshm_input (Linux X11 screen capture from Xvfb)
- **Impact:** Decoupled OBS from Chrome, improved stability
- **Date:** 2026-03-03 12:08:55

### 2. Content Rendering Pipeline
- **Old:** Static HTML or OBS browser control
- **New:** React 19.1.0 + Zustand 5.0.5 + Tailwind 4.1.4 via Vite HMR
- **Impact:** Hot-reload support, rich interactive content
- **Date:** 2026-03-03 13:29:47

### 3. Terminology Change
- **Old:** "sessions" for streamer instances
- **New:** "stages" for streamer instances
- **Scope:** Go codebase + 10+ dashboard components
- **Impact:** BREAKING — external docs must update
- **Date:** 2026-03-03 11:03:06

### 4. MCP Tools Renamed
- **Old:** create, destroy
- **New:** start, stop
- **Terminology:** active/inactive instead of running/stopped
- **Impact:** BREAKING — external scripts must update
- **Date:** 2026-03-03 11:25:10

### 5. State Management
- **New Tool:** emit_event (WebSocket-based state events)
- **Pattern:** Elm-style event-driven updates
- **Benefit:** Decoupled view from state, better HMR support
- **Date:** 2026-03-03 10:29:48

---

## Components at a Glance

### control-plane (Go)
- **Version:** Go 1.24.0
- **Status:** Actively developed
- **Last Modified:** 2026-03-03 11:00:16
- **Key Files:** main.go (27 KB), mcp.go (26 KB)
- **MCP Tools:** 9 total
- **RPC Services:** 5 (Session, ApiKey, Stream, User, Endpoint)
- **Database:** PostgreSQL with 5 tables + 3 migrations

### server (Node.js)
- **Runtime:** Node.js 20
- **Status:** Actively developed  
- **Last Modified:** 2026-03-03 14:06:54
- **Key Framework:** Express + Vite (dev server middleware mode)
- **New Files:** prelude.js, vite-init.mjs
- **Content Features:** React JSX, Zustand state, Tailwind CSS
- **Screen Resolution:** 1280x720 (configurable)

### dashboard (React/TypeScript)
- **Version:** React 19.0.0, TypeScript 5.6.0
- **Status:** Actively developed
- **Last Modified:** 2026-03-03 07:26:51
- **Pages:** 4 (Landing, Dashboard, Docs, StreamConfig)
- **Onboarding:** 6 wizard components
- **UI Library:** 7 reusable components

---

## Database Schema Changes

### New Table: endpoints (Migration 003)
```sql
CREATE TABLE endpoints (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL REFERENCES users(id),
    name TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

### Minor Update: session_log (Migration 002)
- Made `direct_port` nullable

### Existing Tables
- users (1 table, created 001)
- api_keys (1 table, created 001)
- stream_destinations (1 table, created 001)
- session_log (1 table, created 001)

---

## Documentation Status

### Files Requiring Updates
1. **CLAUDE.md** — Terminology (sessions→stages), OBS architecture
2. **docs/architecture-streamer.md** — xshm_input, Vite HMR setup
3. **docs/architecture-control-plane.md** — MCP tools (start/stop), Endpoints service
4. **docs/integration-architecture.md** — React/Zustand/Tailwind, state management pattern
5. **docs/deployment-guide.md** — Docker Ubuntu 24.04, PulseAudio config
6. **docs/data-models.md** — Endpoints table schema
7. **docs/api-contracts.md** — EndpointService definition

### Files Up to Date
- docs/project-overview.md
- docs/development-guide.md
- docs/source-tree-analysis.md
- docs/index.md

---

## MCP Tools Reference

| Name | Type | New | Breaking | Description |
|------|------|-----|----------|-------------|
| start | Command | No | Yes (rename) | Activate stage (create pod) |
| stop | Command | No | Yes (rename) | Deactivate stage (destroy pod) |
| status | Command | No | No | Get stage status |
| set_script | Content | No | No | Set JS/JSX content |
| get_script | Content | No | No | Get current content |
| edit_script | Content | No | No | Edit via find/replace |
| emit_event | State | **Yes** | No | Push state via WebSocket |
| screenshot | Output | No | No | Capture PNG |
| gobs | OBS | No | No | Run OBS commands |

---

## Integration Points

### Session Manager → Streamer Pod
- **MCP WebSocket:** OBS WebSocket (4455), Chrome CDP (9222)
- **HTTP:** Content files served from /tmp/content
- **Protocol:** Connect RPC over HTTP/2

### Streamer Pod → Dashboard
- **HLS Stream:** Live preview via ffmpeg pipeline
- **gRPC/Connect:** Session status, stream logs
- **Status Check:** /health endpoint on 8080

### Dashboard → Session Manager
- **gRPC/Connect:** CRUD for sessions, endpoints, API keys
- **Authentication:** Clerk OAuth + Bearer token
- **Endpoints:** Create/List/Delete MCP endpoints

---

## Breaking Changes Summary

### 1. MCP Tool Names (Severity: High)
- **Date:** 2026-03-03 11:25:10
- **Old Names:** create, destroy
- **New Names:** start, stop
- **Action Required:** Update scripts, documentation, third-party integrations
- **Timeline:** Immediate

### 2. Terminology (Severity: High)
- **Date:** 2026-03-03 11:03:06
- **Change:** sessions → stages
- **Scope:** All MCP tools, documentation, UI
- **Action Required:** Update external documentation, guides, tutorials
- **Timeline:** Within 1 week

---

## Testing Recommendations

1. **Unit Tests**
   - Test new emit_event WebSocket handling
   - Verify xshm_input OBS configuration
   - Validate React/Zustand state persistence

2. **Integration Tests**
   - Test hot-reload with edit_script
   - Verify state persistence across HMR
   - Test multi-panel content rendering

3. **E2E Tests**
   - Onboarding flow with new terminology
   - Start/stop stage lifecycle (renamed tools)
   - Content rendering with React/Zustand/Tailwind

4. **Performance Tests**
   - xshm_input capture performance vs browser_source
   - HMR update latency
   - State event throughput

---

## Cleanup Completed

- Removed orphaned k8s manifests (browserless-deployment.yaml, etc.)
- Deleted obsolete HTML files (example.html, viewer.html)
- **Date:** 2026-03-03 14:09:48
- **Status:** All dead code removed

---

## Next Actions

### High Priority
1. Update CLAUDE.md with new terminology and architecture
2. Update docs/architecture-*.md with xshm_input and Vite HMR details
3. Publish breaking change notice (MCP tool names, "stages" terminology)

### Medium Priority
1. Add React/Zustand/Tailwind examples to onboarding documentation
2. Document emit_event pattern for state-driven content
3. Update integration tests to use new tool names

### Low Priority
1. Add automated test suite (currently missing)
2. Document OBS GPU crash fix and software rendering workaround
3. Create migration guide for external tools/scripts

---

## Files Referenced in This Rescan

**Source Code:**
- /Users/johnsabath/projects/browser-streamer/control-plane/main.go
- /Users/johnsabath/projects/browser-streamer/control-plane/mcp.go
- /Users/johnsabath/projects/browser-streamer/streamer/index.js
- /Users/johnsabath/projects/browser-streamer/streamer/prelude.js
- /Users/johnsabath/projects/browser-streamer/streamer/vite-init.mjs
- /Users/johnsabath/projects/browser-streamer/web/src/components/onboarding/mcp-tools.ts

**Configuration:**
- /Users/johnsabath/projects/browser-streamer/streamer/docker/Dockerfile
- /Users/johnsabath/projects/browser-streamer/streamer/docker/entrypoint.sh
- /Users/johnsabath/projects/browser-streamer/control-plane/go.mod

**Database:**
- /Users/johnsabath/projects/browser-streamer/control-plane/migrations/*.up.sql

**Build Output:**
- /Users/johnsabath/projects/browser-streamer/docs/rescan-findings.json (this report's data)
- /Users/johnsabath/projects/browser-streamer/docs/rescan-summary.md (this report's summary)

---

**Report Generated:** 2026-03-03 14:15:00 UTC
**Report Version:** 1.0
**Scan Duration:** ~15 minutes
