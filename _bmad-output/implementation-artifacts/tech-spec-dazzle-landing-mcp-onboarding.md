---
title: 'Dazzle Landing Page & MCP-First Onboarding'
slug: 'dazzle-landing-mcp-onboarding'
created: '2026-03-02'
status: 'ready-for-dev'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['React 19', 'TypeScript', 'Vite 6', 'Tailwind 4', 'Clerk', 'ConnectRPC', 'Go 1.24', 'PostgreSQL', 'k8s client-go', 'OBS Studio', 'ffmpeg', 'HLS.js']
files_to_modify: ['session-manager/mcp.go', 'session-manager/main.go', 'session-manager/db.go', 'session-manager/migrations/003_endpoints.up.sql', 'session-manager/proto/api/v1/session.proto', 'dashboard/src/pages/LandingPage.tsx', 'dashboard/src/pages/Dashboard.tsx', 'dashboard/src/pages/GetStarted.tsx', 'dashboard/src/App.tsx', 'dashboard/src/components/onboarding/ConnectionDetails.tsx', 'dashboard/package.json', 'docker/entrypoint.sh', 'server/index.js']
code_patterns: ['flat Go package structure', 'in-memory session map + DB logging', 'ConnectRPC interceptors for auth', 'shadcn-style UI with CVA', 'Clerk SignedIn/SignedOut splits', 'framework.getSnippet(mcpUrl, apiKey) for code generation']
test_patterns: ['no test suites — go vet + npm run build only']
---

# Tech-Spec: Dazzle Landing Page & MCP-First Onboarding

**Created:** 2026-03-02

## Overview

### Problem Statement

The landing page hero ("Every agent deserves an audience") is poetic but doesn't communicate what the product does. The onboarding wizard gates MCP connection behind 4-5 steps (path selection, framework, streaming config, session creation) when the actual integration is a single config line. Users endure a 3-minute chore instead of a 10-second win.

### Solution

Swap the landing page hero to "Give your AI agent a stage," auto-provision an endpoint + API key on first dashboard load, and replace the onboarding wizard with a welcome screen that immediately shows the MCP URL and copy-paste snippet. Move stream destination configuration out of onboarding into settings.

### Scope

**In Scope:**
- Persistent endpoint entity (thin DB layer — UUID survives pod lifecycle)
- Landing page messaging overhaul (hero, subhead, CTA copy, use-case cards)
- Auto-provision first endpoint + API key on first dashboard load
- New welcome screen replacing wizard as default post-signup experience
- Dashboard stream preview (HLS player showing agent's stage live)
- Soft landing into streaming — contextual prompts, not wizard gates
- Stream destination config moved out of onboarding to settings
- Demo video placeholder on landing page

**Out of Scope:**
- Live embedded stream on landing page (the dashboard preview is separate)
- ExplainerStep content rewrites
- New framework integrations
- Backend MCP tool changes (beyond endpoint entity + auto-HLS trigger)
- Clerk webhook infrastructure
- Mobile-specific layout overhaul
- WebRTC/WHEP low-latency streaming (HLS at 2-4s is sufficient for now)

## Context for Development

### Codebase Patterns

**Dashboard (React/TypeScript):**
- React 19 + TypeScript + Vite 6 + Tailwind 4 (CSS-first config, no tailwind.config.js)
- `.js` extensions mandatory on all TS imports
- Clerk `<SignedIn>`/`<SignedOut>` splits auth vs public views in App.tsx
- Auth token injected via ConnectRPC transport interceptor in client.ts
- UI components are hand-written shadcn-style with CVA + `cn()` helper
- Icons from lucide-react only
- No ESLint/Prettier — match existing formatting
- Path alias `@/*` maps to `./src/*` for cross-cutting imports; relative for nearby files
- Pages in `src/pages/` with named export, routes added in App.tsx
- DM Serif Display for headings, Outfit for body text
- Emerald-400/500 accent on zinc-950 dark theme

**Session Manager (Go):**
- Flat package structure — all Go files in `session-manager/`
- Sessions stored in in-memory `map[string]*Session`, recovered from k8s pods on restart
- Session lifecycle logged to DB (`session_log` table) but not real-time persisted
- MCP routing: `/mcp/<uuid>` → middleware extracts UUID, authenticates (API key or Clerk JWT), stores in context
- `handleMCPStart` creates session, waits for pod ready, then configures OBS stream
- `configureOBSStream` fetches user's first enabled stream destination, configures OBS via gobs-cli
- Auth: API keys (`bstr_` prefix, sha256 hash in DB) or Clerk JWT (JWKS verification)

**Streamer Pod:**
- Entrypoint starts: Xvfb → PulseAudio → Chrome → OBS → Node server
- OBS captures screen via xshm_input, streams to RTMP destination when configured
- Node server (CommonJS, single file): template rendering, CDP proxy, health check
- No HLS output currently — would need ffmpeg or OBS custom output to produce HLS segments
- `/session/:id/hls/*` proxy route exists in session manager but nothing serves HLS on the pod

**Database Schema:**
- `users` (id=Clerk ID, email, name)
- `api_keys` (id, user_id FK, name, prefix, key_hash, last_used_at)
- `stream_destinations` (id, user_id FK, name, platform, rtmp_url, stream_key encrypted, enabled)
- `session_log` (id=session UUID, user_id FK, pod_name, direct_port, started_at, ended_at, end_reason)
- No `endpoints` table yet — needs migration

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `dashboard/src/pages/LandingPage.tsx` | Current landing page — hero, value props, ecosystem strip, Clerk sign-in |
| `dashboard/src/pages/GetStarted.tsx` | Current onboarding wizard — 2 paths, 4-5 steps |
| `dashboard/src/pages/Dashboard.tsx` | Main authenticated dashboard — endpoints list |
| `dashboard/src/App.tsx` | Routing, Clerk auth wrappers |
| `dashboard/src/client.ts` | ConnectRPC clients (session, apiKey, stream, user) |
| `dashboard/src/components/onboarding/frameworks.ts` | Framework definitions + snippet generators |
| `dashboard/src/components/onboarding/ConnectionDetails.tsx` | MCP URL display, snippet copy, API key management |
| `dashboard/src/components/onboarding/SessionCreator.tsx` | Session creation + polling logic |
| `dashboard/src/components/onboarding/StreamDestinationForm.tsx` | RTMP stream config form |
| `dashboard/src/components/onboarding/FrameworkSelector.tsx` | Framework selection grid |
| `dashboard/src/components/onboarding/PathSelector.tsx` | Experienced vs guided path choice |
| `session-manager/mcp.go` | MCP tool handlers — handleMCPStart, configureOBSStream |
| `session-manager/main.go` | Session manager — createSession, pod management, proxy routes |
| `session-manager/migrations/` | DB migrations directory |
| `server/index.js` | Streamer pod Node server — `/api/stream/start` HLS trigger |
| `viewer.html` | Legacy HLS viewer — reference for HLS.js low-latency config |

### Technical Decisions

- **Persistent endpoints (Option C):** New `endpoints` DB table with UUID + owner_user_id + created_at. UUID persists across pod lifecycle. Agent calls MCP `start` → pod spins up behind the endpoint UUID. Pod dies → UUID still valid, next `start` creates new pod. ~50 lines of Go: migration, lookup function, MCP handler tweak.
- **Auto-provisioning on first dashboard load** (not Clerk webhook) — simpler, no backend infra change. Dashboard checks "does user have endpoints?" → if no, create one + API key → display immediately. Idempotent on subsequent loads.
- **Dashboard stream preview:** The pod currently only outputs RTMP (via OBS streaming) — there is no always-on HLS pipeline. The `/session/:id/hls/*` proxy route exists but nothing serves HLS segments. To enable an always-on internal preview, the streamer pod needs an HLS output (likely ffmpeg capturing Xvfb → HLS segments served by the Node server). RTMP to external platforms remains the "open the curtains" upgrade. HLS is the internal backstage monitor — always on when a session is active, consumed only by the dashboard.
- **Framework selector becomes tab switcher** on the snippet display, not a wizard gate. MCP URL + API key are framework-agnostic.
- **Stream destination deferred** — contextual prompts ("Open the curtains") when user has active session but no stream destination. Three entry points: dashboard banner (dismissible, first-time), endpoint detail panel, settings page.
- **Stage framing:** Dazzle gives agents a "production stage," not a "browser." Tools map to stage metaphor: set_html = set the scene, gobs = production controls, screenshot = capture a moment, start/stop = go live / wrap up.
- **Three-moment value ladder:** Moment 0 "Set up" (paste MCP config, 10s) → Moment 1 "Visible" (agent starts, user sees live preview on dashboard) → Moment 2 "Live" (user configures stream destination, agent broadcasts to Twitch/YouTube).

## Implementation Plan

### Tasks

Tasks are ordered by dependency. Each task is a discrete, completable unit.

---

#### Task 1: Create `endpoints` DB table and Go functions

- File: `session-manager/migrations/003_endpoints.up.sql`
- Action: Create migration with `endpoints` table:
  ```sql
  CREATE TABLE IF NOT EXISTS endpoints (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id TEXT NOT NULL REFERENCES users(id),
      name TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
  CREATE INDEX idx_endpoints_user_id ON endpoints(user_id);
  ```
- File: `session-manager/db.go`
- Action: Add endpoint DB functions following existing patterns:
  - `dbCreateEndpoint(db, userID, name) → (id string, err error)` — INSERT returning id
  - `dbListEndpoints(db, userID) → ([]endpointRow, error)` — SELECT by user_id, ordered by created_at
  - `dbGetEndpoint(db, id) → (*endpointRow, error)` — SELECT by id
  - `dbDeleteEndpoint(db, id, userID) → error` — DELETE with ownership check
  - `endpointRow` struct: `ID, UserID, Name, CreatedAt`
- Notes: Follow existing `dbCreateStreamDest` / `dbListStreamDests` patterns exactly. No encryption needed.

---

#### Task 2: Add Endpoint proto service and ConnectRPC handler

- File: `session-manager/proto/api/v1/session.proto`
- Action: Add `EndpointService` to the existing proto file:
  ```protobuf
  service EndpointService {
    rpc CreateEndpoint(CreateEndpointRequest) returns (CreateEndpointResponse);
    rpc ListEndpoints(ListEndpointsRequest) returns (ListEndpointsResponse);
    rpc DeleteEndpoint(DeleteEndpointRequest) returns (DeleteEndpointResponse);
  }
  message Endpoint {
    string id = 1;
    string name = 2;
    google.protobuf.Timestamp created_at = 3;
  }
  message CreateEndpointRequest { string name = 1; }
  message CreateEndpointResponse { Endpoint endpoint = 1; }
  message ListEndpointsRequest {}
  message ListEndpointsResponse { repeated Endpoint endpoints = 1; }
  message DeleteEndpointRequest { string id = 1; }
  message DeleteEndpointResponse {}
  ```
- Action: Run `cd session-manager/proto && buf generate` to regenerate Go + TS code
- File: `session-manager/connect_endpoint.go` (new file in flat structure)
- Action: Create ConnectRPC handler following `connect_session.go` pattern:
  - `CreateEndpoint` — calls `dbCreateEndpoint`, returns Endpoint
  - `ListEndpoints` — calls `dbListEndpoints`, returns list
  - `DeleteEndpoint` — calls `dbDeleteEndpoint` with ownership check
- File: `session-manager/main.go`
- Action: Register `EndpointService` handler in HTTP mux (near line 870-895). Use Clerk-only interceptor (same as ApiKeyService).
- Notes: Endpoint creation is lightweight — just a DB row, no pod. Keep the handler minimal.

---

#### Task 3: Update MCP routing to use persistent endpoint UUIDs

- File: `session-manager/mcp.go`
- Action: Update MCP middleware (around line 131-180) to validate endpoint UUID:
  1. Extract UUID from path (already done)
  2. After auth, look up endpoint via `dbGetEndpoint(db, uuid)`
  3. Verify the authenticated user owns this endpoint (endpoint.UserID == authInfo.UserID)
  4. If endpoint not found, return 404
  5. Store endpoint ID in context (alongside existing agentID)
- Action: Update `handleMCPStart` (around line 195-253):
  1. Use endpoint UUID as the session key (it already uses `agentID` which is the UUID from the path — this maps directly)
  2. When creating a session, pass the endpoint UUID as the session ID via `m.createSession(endpointID)`
  3. Session ownership now implicitly validated through endpoint ownership
- Notes: The current flow already uses the MCP path UUID as the session identifier. The change is: validate that UUID exists as an endpoint row AND belongs to the user, rather than accepting any UUID. Existing sessions created by MCP `start` already use this UUID as the session key in the in-memory map.

---

#### Task 4: Add HLS output to streamer pod

- File: `docker/entrypoint.sh`
- Action: After OBS WebSocket is ready (after line 186), start ffmpeg to capture Xvfb and produce HLS segments:
  ```bash
  # 6. Start HLS preview pipeline
  echo "Starting HLS preview..."
  mkdir -p /tmp/hls
  ffmpeg -f x11grab -video_size ${SCREEN_WIDTH}x${SCREEN_HEIGHT} -framerate 30 -i :99 \
      -c:v libx264 -preset ultrafast -tune zerolatency -g 30 \
      -f hls -hls_time 1 -hls_list_size 5 -hls_flags delete_segments+append_list \
      -hls_segment_filename '/tmp/hls/seg%03d.ts' /tmp/hls/stream.m3u8 &
  FFMPEG_PID=$!
  ```
  Add `kill "$FFMPEG_PID"` to cleanup function.
- File: `server/index.js`
- Action: Add static file serving for HLS segments (before the server.listen call):
  ```javascript
  // Serve HLS preview segments (no auth — internal use only, proxied through session manager with auth)
  app.use('/hls', express.static('/tmp/hls', {
      setHeaders: (res) => {
          res.setHeader('Cache-Control', 'no-cache, no-store');
          res.setHeader('Access-Control-Allow-Origin', '*');
      }
  }));
  ```
- File: `docker/Dockerfile`
- Action: Ensure `ffmpeg` is installed in the streamer image (check if already present — likely yes since OBS depends on it, but verify).
- Notes: HLS segments live at `/tmp/hls/stream.m3u8` on the pod. Session manager proxies `/session/:id/hls/*` → pod port 8080 `/hls/*`. 1-second segments with 5-segment playlist gives ~2-4s latency. `delete_segments` prevents disk growth. `ultrafast` preset minimizes CPU overhead.

---

#### Task 5: Add `endpointClient` to dashboard

- File: `dashboard/src/client.ts`
- Action: Import generated `EndpointService` and create client:
  ```typescript
  import { EndpointService } from "./gen/api/v1/session_connect.js";
  export const endpointClient = createClient(EndpointService, transport);
  ```
- Notes: After `buf generate` (Task 2), the TS client code will be in `dashboard/src/gen/`. The EndpointService will be in the same connect file as SessionService since they share the proto file.

---

#### Task 6: Landing page messaging overhaul

- File: `dashboard/src/pages/LandingPage.tsx`
- Action — Hero section (around lines 96-119):
  - Replace heading: `"Every agent deserves an audience"` → `"Give your AI agent a stage."`
  - Emerald highlight on `"a stage."` (keep the `<span className="text-emerald-400">` pattern)
  - Replace subheading: current text → `"Every agent deserves an audience. Dazzle gives yours a production stage — visible, streamable, controllable via MCP."`
  - Replace primary CTA: `"Get Started"` → `"Launch a session"`
- Action — Value props section (around lines 145-166):
  - Replace 3 abstract cards with use-case cards:
    1. Eye icon → `"Watch your agent work"` / `"See every action in real time on your private dashboard preview."`
    2. Share2 icon → `"Stream it to the world"` / `"Go live on Twitch, YouTube, or any RTMP destination when you're ready."`
    3. Plug icon → `"One line to connect"` / `"Add your MCP endpoint to any agent framework. Claude Code, OpenAI, CrewAI, and more."`
- Action — Ecosystem strip (around lines 170-190):
  - Add subheading above strip: `"One MCP endpoint. Every agent framework."`
- Action — Final CTA section (around lines 193-230):
  - Replace `"Ready to give your agents a stage?"` → keep this (it works)
  - Replace CTA button text if needed
- Action — Demo video placeholder (new section between hero and value props):
  - Add a 16:9 aspect ratio container with zinc-900 background, centered play icon, and text `"See an agent in action"`. This is a placeholder for a future looping video.
- Notes: Keep all existing animation classes, font families (DM Serif Display / Outfit), color scheme (emerald on zinc-950), and Clerk sign-in modal integration. Only change copy and add the video placeholder.

---

#### Task 7: Auto-provision endpoint + API key on first dashboard load

- File: `dashboard/src/pages/Dashboard.tsx`
- Action: Add auto-provisioning logic to the existing data-fetching effect:
  1. On mount, call `endpointClient.listEndpoints({})` alongside existing `sessionClient.listSessions({})`
  2. If endpoints list is empty (first-time user):
     a. Call `endpointClient.createEndpoint({ name: "default" })` → get endpoint UUID
     b. Call `apiKeyClient.listApiKeys({})` — if empty, call `apiKeyClient.createApiKey({ name: "default" })` → get API key secret
     c. Store endpoint + apiKey in component state
     d. Show welcome screen (Task 8) instead of the empty state
  3. If endpoints exist: show the normal endpoint list (adapted from current session list)
  4. Idempotent: subsequent loads see existing endpoints, skip provisioning
- Action: Replace current `sessions` state/display with `endpoints` as the primary entity. Each endpoint card shows:
  - Endpoint UUID (the MCP address)
  - Active session status (if any running session matches this endpoint ID)
  - Stream destination status
- Notes: The auto-provisioning runs once, creates a DB row (endpoint) and potentially an API key. No pod is started. The dashboard becomes endpoint-centric rather than session-centric.

---

#### Task 8: New welcome screen (replaces wizard)

- File: `dashboard/src/pages/Dashboard.tsx` (or new `dashboard/src/components/WelcomeScreen.tsx`)
- Action: Create a welcome screen component shown after auto-provisioning (when user has endpoints but hasn't connected yet). Content:
  1. **Header:** `"Your agent's stage is ready."` (DM Serif Display)
  2. **MCP URL display:** `https://stream.dazzle.fm/mcp/<endpoint-uuid>` with copy button
  3. **API key display:** masked key (`bstr_xxxx••••••••`) with copy button + warning "Save this — shown once"
  4. **Framework snippet tabs:** Reuse framework tab pattern from `ConnectionDetails.tsx` — tabs for Claude Code, OpenAI, CrewAI, LangGraph, AutoGen, OpenClaw. Each tab shows the one-liner config with the user's actual MCP URL and env var reference.
  5. **Env var instruction:** `export DAZZLE_API_KEY=<your-key>`
  6. **Connection status indicator:** `"Waiting for your agent to connect..."` with a subtle pulsing dot. When a session appears for this endpoint (poll `sessionClient.listSessions({})` every 5s), flip to `"Connected!"` with emerald checkmark.
  7. **"I'm new to this" toggle:** Expands a brief 3-panel explainer (reuse content from `ExplainerStep.tsx`) around the snippet area. Default: collapsed.
- Notes: This is essentially a streamlined version of `ConnectionDetails.tsx` with auto-provisioned data pre-filled. Reuse `frameworks.ts` `getSnippet()` for snippet generation. The key difference from current onboarding: no wizard steps, no gates, everything visible on one screen.

---

#### Task 9: Dashboard stream preview component

- File: `dashboard/package.json`
- Action: Add `hls.js` dependency: `npm install hls.js`
- File: `dashboard/src/components/StreamPreview.tsx` (new)
- Action: Create HLS player component:
  ```typescript
  interface StreamPreviewProps {
    sessionId: string;
    status: "starting" | "running" | "stopped";
  }
  ```
  - When `status === "running"`: initialize HLS.js pointed at `/session/${sessionId}/hls/stream.m3u8`
  - Low-latency config from viewer.html: `liveSyncDurationCount: 3`, `liveMaxLatencyDurationCount: 6`, `maxBufferLength: 5`, `lowLatencyMode: true`
  - Auth: use `xhrSetup` callback to inject Bearer token from Clerk (get via `useAuth()`)
  - When `status !== "running"`: show placeholder — dark container with text `"Your agent's stage is dark. It'll light up when your agent connects."`
  - Aspect ratio: 16:9, rounded corners, zinc-900 background
  - Error recovery: on network error, destroy and reload after 2s (same pattern as viewer.html)
  - Cleanup: destroy HLS instance on unmount
- File: `dashboard/src/pages/Dashboard.tsx`
- Action: Embed `<StreamPreview>` in the endpoint detail panel (slide-over). Show above the "Connect" section. Find the active session for this endpoint (by matching session owner + endpoint UUID) and pass its ID and status.
- Notes: The preview only works when a pod is running. This is expected — the agent starts the pod via MCP `start`. Before that, the placeholder is shown.

---

#### Task 10: Soft landing into streaming

- File: `dashboard/src/pages/Dashboard.tsx`
- Action: Add a dismissible banner component at the top of the dashboard:
  - Show condition: user has at least one active session AND no stream destinations configured
  - Content: `"Your agent has a stage. Ready to open the curtains?"` with a `"Set up streaming"` button
  - Dismiss: store dismissal in localStorage (`dazzle-stream-banner-dismissed`)
  - Button navigates to stream destination setup (inline or settings page)
- File: `dashboard/src/pages/Dashboard.tsx` (slide-over panel)
- Action: In the endpoint detail slide-over, add a "Streaming" section below the preview:
  - If stream destination exists: show platform badge + enabled/disabled toggle (already partially exists)
  - If no stream destination: show `"Open the curtains"` link → opens `StreamDestinationForm` inline (compact mode)
- Notes: `StreamDestinationForm` already supports `compact` and `hideSkip` props. Reuse it directly. The form's `onNext` callback calls `streamClient.createStreamDestination()` (same as current onboarding flow).

---

#### Task 11: Update routing

- File: `dashboard/src/App.tsx`
- Action:
  - Keep `/get-started` route but make it redirect to `/` (dashboard) for backward compatibility. The wizard is no longer the primary onboarding path.
  - Alternatively: keep `/get-started` as a guided tutorial for users who click "I'm new to this" on the welcome screen, but simplify it to skip stream destination and framework selection gates.
  - Add `/settings` route if stream destination management needs a dedicated page (or keep it inline in dashboard).
- Notes: The key routing change is that new users land on `/` (Dashboard) which now handles auto-provisioning and the welcome screen. No redirect to `/get-started` needed.

---

### Acceptance Criteria

- [ ] AC 1: Given a new user who just signed in via Clerk, when the Dashboard loads for the first time, then an endpoint UUID and API key are auto-created and the welcome screen is displayed with MCP URL, API key, and framework snippets.

- [ ] AC 2: Given a user on the welcome screen, when they view the framework snippets, then tabs for all 6 frameworks are shown with the correct MCP URL pre-filled and a copy button works for each.

- [ ] AC 3: Given a returning user with existing endpoints, when the Dashboard loads, then the endpoint list is shown (not the welcome screen) and no duplicate endpoints are created.

- [ ] AC 4: Given an agent that calls MCP `start` on a valid endpoint UUID, when the endpoint exists and belongs to the authenticated user, then a session pod is created and the agent receives a success response.

- [ ] AC 5: Given an agent that calls MCP `start` on a UUID that is not a valid endpoint, when the request is received, then a 404 error is returned.

- [ ] AC 6: Given a running session on the streamer pod, when the pod is active, then HLS segments are produced at `/hls/stream.m3u8` and the session manager can proxy them via `/session/:id/hls/*`.

- [ ] AC 7: Given a user viewing an endpoint with an active session in the dashboard, when they open the endpoint detail panel, then a live HLS preview of the agent's stage is displayed with <5s latency.

- [ ] AC 8: Given a user with no active session, when they view the stream preview area, then a placeholder message is shown instead of a broken player.

- [ ] AC 9: Given a user with an active session but no stream destination, when they view the dashboard, then a dismissible banner prompts them to set up streaming with "Open the curtains" messaging.

- [ ] AC 10: Given a user who dismisses the streaming banner, when they reload the dashboard, then the banner does not reappear.

- [ ] AC 11: Given the landing page, when a visitor loads it, then the hero reads "Give your AI agent a stage." with the subhead referencing "Every agent deserves an audience" and the primary CTA says "Launch a session."

- [ ] AC 12: Given the landing page, when a visitor scrolls to the value props, then three use-case cards are shown (Watch your agent work / Stream it to the world / One line to connect) with a demo video placeholder above.

- [ ] AC 13: Given a user who clicks "I'm new to this" on the welcome screen, when the toggle is activated, then a brief explainer panel expands around the snippet area without navigating away.

- [ ] AC 14: Given a user on the welcome screen with auto-provisioned endpoint, when their agent connects and a session starts, then the connection status flips from "Waiting..." to "Connected!" within one poll cycle (5s).

## Additional Context

### Dependencies

- `hls.js` npm package for dashboard stream preview
- `ffmpeg` in streamer pod Docker image (verify already installed)
- New `endpoints` DB table (PostgreSQL migration 003)
- New `EndpointService` proto + generated code (both Go and TS)
- New `endpointClient` in dashboard `client.ts`
- Existing: ConnectRPC clients (sessionClient, apiKeyClient, streamClient), Clerk auth, OBS Studio, gobs-cli

### Testing Strategy

- **Build validation:** `go vet ./...` (Go) + `cd dashboard && npm run build` (TypeScript type check)
- **Manual testing — Happy path:**
  1. Fresh user sign-up → verify auto-provisioned endpoint + API key appear on welcome screen
  2. Copy Claude Code snippet → paste in terminal → verify agent connects → verify "Connected!" indicator
  3. Verify HLS preview appears in endpoint detail panel when session is running
  4. Verify streaming banner appears → click through → configure Twitch → verify OBS streams
  5. Dismiss banner → reload → verify stays dismissed
  6. Verify landing page hero, value props, CTA copy updated
- **Manual testing — Edge cases:**
  1. Reload dashboard multiple times → verify no duplicate endpoints created
  2. Session pod dies (idle timeout) → verify endpoint persists, "stage is dark" placeholder shown
  3. Agent calls `start` again on same endpoint → verify new pod created behind same UUID
  4. Invalid endpoint UUID in MCP request → verify 404
  5. API key auth on MCP endpoint → verify works (not just Clerk JWT)
- **Pre-deploy:** `make build` (both images) + `make deploy` on staging first

### Notes

- **Risk: HLS CPU overhead.** ffmpeg encoding Xvfb at 720p30 with ultrafast preset should be lightweight (~5-10% CPU on the pod), but monitor. The pod already runs Chrome + OBS + Node which is CPU-heavy. If overhead is too high, consider reducing to 15fps or 480p for preview.
- **Risk: Migration on existing data.** The `endpoints` table is new — no data migration needed. But the MCP routing change (requiring valid endpoint UUID) means existing MCP URLs will break unless endpoints are backfilled for existing users. Consider: on first MCP request with unknown UUID, auto-create an endpoint for that UUID if the user is authenticated. This provides backward compatibility.
- **Future consideration:** Endpoint naming/labeling, multiple endpoints per user, per-endpoint stream destinations. All enabled by the endpoint entity but out of scope for this spec.
- **Brainstorming source:** 118 ideas at `_bmad-output/brainstorming/brainstorming-session-2026-03-02-1900.md`
- **Key framing:** "Stage" not "browser." HLS = backstage monitor. RTMP = opening the curtains. MCP tools = stage controls.
