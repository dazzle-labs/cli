---
title: 'Stream Repo Merge — Harness + Timeline Primitives into Agent-Streamer'
slug: 'stream-repo-merge'
created: '2026-03-05'
status: 'Implementation Complete'
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]
tech_stack: ['TypeScript', 'React 19', 'Vite 6', 'Node.js 20', 'MCP (HTTP transport)', 'Go 1.24', 'ConnectRPC', 'Vercel AI SDK v6', 'Zod v3', 'ffmpeg (HLS→MP4)']
files_to_modify: ['web/tsconfig.json', 'web/vite.config.ts', 'web/src/components/onboarding/mcp-tools.ts', 'harness/lib/agent.ts (refactor: stdio→HTTP MCP)', 'harness/lib/scenario.ts (refactor: createWorkspace→createStage)', 'harness/run.ts (refactor: Puppeteer→HLS capture, WebSocket→MCP polling)', 'harness/lib/recorder.ts (replace: WebSocket→get_script polling)', 'harness/lib/video-capture.ts (replace: Puppeteer→HLS download+ffmpeg)']
code_patterns: ['Pure MCP client — zero direct pod connections', 'HLS segment download + ffmpeg stitch for video capture', 'get_script polling for scene observation (no WebSocket)', 'Path alias @shared/* for cross-directory imports', 'spawner.ts + system-prompt.ts deleted', 'Puppeteer + ws dependencies removed']
test_patterns: ['No test framework — validation via tsc -b + vite build + harness smoke run']
---

# Tech-Spec: Stream Repo Merge — Harness + Timeline Primitives into Agent-Streamer

**Created:** 2026-03-05

## Overview

### Problem Statement

The `stream/` repo contains the **automated improvement loop** — an evaluation harness that runs AI agents against creative scenarios, captures video/scene data/tool calls, evaluates output via LLM with harsh criticism, and identifies platform gaps. This loop is the development engine: run → evaluate → identify gaps → build → repeat. The goal is autopilot — the platform improves itself through this cycle.

This harness, along with timeline primitives, protocol types, 14 scenarios, and 2 days of research context, is trapped in an isolated repo. It cannot target the production dazzle platform, there's no shared type system, and the web dashboard has no awareness of the protocol contract being developed. The two codebases need to unify so the harness drives the real platform forward.

### Solution

Merge `stream/` into agent-streamer with three structural goals:

1. **Harness as MCP client** — top-level `harness/` that connects to dazzle's control plane the same way any agent would. No privileged access, no local server. If the harness can't do something through the tool surface, that's a gap in the tool surface.

2. **Shared protocol contract** — top-level `shared/` with TypeScript types that define the protocol between agents, the control plane, the web dashboard, and the harness. These types support **dual representation** (visual for humans, structured for agents to consume/compose).

3. **Research and scenario preservation** — all docs, distilled requirements, research, and scenarios carry over as project knowledge to inform protocol evolution.

### Design Goals (from Conner's relocation requirements)

These goals are **implementation-independent** — they must survive renderer swaps, protocol changes, and model changes:

1. **Token efficiency** — agents describe complex audiovisuals with minimal tokens, faster than real time. Templates reduce ~1000 tokens/scene to ~100.
2. **Declarative over imperative** — agents describe *what* they want, not *how* to build it step by step. The current imperative set/patch model is explicitly failing and open to radical replacement.
3. **Composability** — agent output must be consumable by other agents, not just human viewers. Streams feed into other streams.
4. **First-render quality** — no iterative screenshot-and-fix loops. Output must be good on first display.
5. **Framework independence** — the evaluation layer must survive renderer swaps, protocol changes, model changes. Three abstraction interfaces identified: `AgentDriver`, `VisualCapture`, `SceneObserver`.
6. **Cinematic quality** — output should look like broadcast media (Apple Keynote, CNN/ESPN, Bloomberg), not dashboards.

### Scope

**In Scope:**
- Top-level `harness/` directory — evaluation pipeline, 14 scenarios, **pure MCP client** (HTTP to dazzle control plane — zero direct pod connections), HLS-based video capture, MCP-based scene observation, replay, multi-pass evaluation (blind media critic, task completion, platform gap analysis)
- Top-level `shared/` directory — TypeScript source-of-truth for protocol contract types (`TimelineEntry`, `TransitionSpec`, `Timeline`, `Spec`, `PatchOp`, `WSMessage`, stream events, dual representation types). Both `web/` and `harness/` import from here.
- **Framework independence boundaries** — document the 2 MCP coupling points in the harness (`agent.ts:createMCP` and `scenario.ts:createWorkspace`) and define the `AgentDriver`, `VisualCapture`, `SceneObserver` interface boundaries (even if not fully abstracted day-one)
- Timeline MCP tool definitions added to `web/src/components/onboarding/mcp-tools.ts`
- All `stream/docs/` content archived under `docs/stream-research/` (15 distilled docs, 8 research docs, 588-line history context, agentic broadcasting spec, declarative rendering research, timeline design, protocol spec)
- Harness spec and all 14 scenario definitions
- Baseline scores preserved for regression tracking (hello-world: 6.5/10, cinematic-broadcast: 3/10)

**Out of Scope:**
- Changing the protocol (it's in flux — carry as-is, but the shared types must be designed to evolve)
- Building a new renderer or adopting Remotion (active research, not decided)
- Implementing timeline tools in the Go control plane (separate spec — this establishes the shared types they'll conform to)
- Template system implementation (7 template types identified but not built — research carries over)
- Audio features (TTS, background music, sound design — research exists, nothing built)
- ACP / multi-agent composability implementation (research carries over)
- Local dev mock server (harness targets dazzle only — no local fallback)

## Context for Development

### Codebase Patterns

- `stream/` is a separate git repo currently nested inside the agent-streamer working tree (untracked). It has its own `.git`, `CLAUDE.md`, `AGENTS.md`, `.mcp.json`, and `node_modules`.
- The agent-streamer monorepo has component directories: `control-plane/` (Go), `web/` (React/Vite), `streamer/` (Node.js). Each has its own Makefile.
- Web dashboard uses `.js` extensions on TS imports, strict mode, path alias `@/*` for `./src/*`.
- No shared packages/libs directory exists yet — this merge introduces the first shared code via `shared/`.
- The stream protocol is explicitly in flux (see RELOCATION_DOCUMENTATION.md) — the current Spec/patch/snapshot model may be replaced. The harness must remain implementation-independent.
- **Dazzle streamer already produces HLS** — ffmpeg x11grab at 30fps, 1s segments at `/tmp/hls/stream.m3u8`, served via Express at `/hls/*` on the pod (no auth, internal). **The control plane already proxies this** — `handleStageProxy` (`main.go:511`) is a generic reverse proxy that routes all non-MCP, non-CDP paths under `/stage/<uuid>/*` to the pod on port 8080 with auth via `authMiddlewareHTTP`. So `/stage/<uuid>/hls/stream.m3u8` works today with Bearer auth — no new Go route needed.
- **MCP over HTTP** — control plane exposes MCP at `/stage/<uuid>/mcp/callTool` with Bearer token auth (API key or Clerk JWT). Existing tools: `start`, `stop`, `status`, `set_script`, `get_script`, `edit_script`, `emit_event`, `get_logs`, `screenshot`, `obs`.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `stream/src/core/spec.ts` | Core types: Spec, UIElement, PatchOp, WSMessage — becomes `shared/core/spec.ts` |
| `stream/src/core/timeline.ts` | Timeline types: TimelineEntry, TransitionSpec, Timeline — becomes `shared/core/timeline.ts` |
| `stream/src/core/patch.ts` | JSON Patch application logic — becomes `shared/core/patch.ts` |
| `stream/src/core/expressions.ts` | State binding expression resolver — becomes `shared/core/expressions.ts` |
| `stream/src/core/catalog.ts` | Component catalog system — becomes `shared/core/catalog.ts` |
| `stream/src/core/registry.ts` | Component registry — becomes `shared/core/registry.ts` |
| `stream/harness/` | Evaluation harness — becomes top-level `harness/` |
| `stream/harness/lib/types.ts` | Harness types: StreamEvent, ToolCall, SessionResult — stays in `harness/lib/types.ts` |
| `stream/src/server/` | Stream server — archived as reference, not carried as runnable code |
| `stream/docs/timeline-design.md` | Timeline system design doc — becomes `docs/stream-research/timeline-design.md` |
| `stream/SPEC.md` | Current protocol spec — becomes `docs/stream-research/SPEC.md` |
| `stream/RELOCATION_DOCUMENTATION.md` | Migration intent and context — becomes `docs/stream-research/RELOCATION_DOCUMENTATION.md` |
| `stream/docs/distilled/` | 15 distilled requirement docs — becomes `docs/stream-research/distilled/` |
| `stream/docs/research/` | 8 research docs — becomes `docs/stream-research/research/` |
| `control-plane/mcp.go` | Go MCP server — where timeline tools will eventually be added (separate spec) |
| `streamer/index.js` | Streamer pod HTTP API — panel system, HLS serve, OBS client |
| `streamer/docker/entrypoint.sh` | HLS pipeline config (ffmpeg x11grab → m3u8) |
| `web/src/components/onboarding/mcp-tools.ts` | Current dazzle MCP tool definitions for web UI |

### Technical Decisions

- **Harness is an MCP client, not a server host.** It connects to dazzle's control plane via HTTP MCP (`/stage/<uuid>/mcp/callTool`), the same way any agent would. No privileged access. This is a fundamental design constraint — the harness validates the real platform.
- **Shared types are the protocol contract.** `shared/core/` is the TypeScript source of truth. The Go control plane will need matching types when timeline tools are implemented (separate spec — likely proto-generated via `buf generate`).
- **Stream server code is archived reference.** The dazzle streamer pod + control plane is the production platform. The stream server's patterns inform future work but don't ship as runnable code.
- **Video capture via HLS.** The harness downloads m3u8 segments and stitches to MP4 with ffmpeg. This is the ground truth — it's literally what viewers see. Replaces Puppeteer screen recording entirely. The HLS proxy already exists — `handleStageProxy` (`main.go:511`) reverse-proxies `/stage/<uuid>/hls/*` to the pod's `/hls/*` endpoint with Bearer auth via `authMiddlewareHTTP`. No new Go code needed.
- **Scene observation via MCP.** The harness polls `get_script` via MCP tool calls instead of connecting directly to pod WebSocket. Stays within the MCP contract. Replaces the `Recorder` class (WebSocket-based). Polling interval ~500ms matches current behavior. **Note:** The dazzle tool is `get_script`, not `sceneRead`. The harness must call `get_script` and parse the returned JSX/spec content.
- **Declarative specs render as JSX on dazzle.** The `Spec` type renders natively on dazzle's streamer pod via a `SpecRenderer` component loaded in the prelude. Agents send specs via `set_script` wrapped in `<SpecRenderer spec={...} />`. This preserves the declarative scene spec model — scenarios don't need rewriting, the component catalog works as-is, and the dual representation (visual + agentic) is maintained. The stream server's custom React renderer logic ports to a prelude-loaded component.
- **Timeline primitives are TS source of truth for now.** Proto definitions come later when the protocol stabilizes, matching the existing `buf generate` pipeline.
- **Protocol is open to radical change.** Everything about the current Spec/patch/snapshot model, the MCP tool surface, and the component catalog is a starting point, not a final design. Active research directions: Remotion, json-render patterns, template/composition system (7 types, ~100 tokens/scene), ACP/multi-agent composability, audio, protocol surface area reduction (11 tools → ~4). The shared types must be designed to evolve without breaking the harness.
- **Dual representation is core.** Every stream output has a visual form (rendered for humans) and an agentic form (structured data for other agents to consume/compose). The `Spec` type itself IS the dual representation. This principle must survive protocol changes.
- **Evaluation is harsh and multi-pass.** Three independent perspectives: (1) blind media critic — judges purely as visual media, no platform knowledge; (2) task completion — compares scenario goals vs actual output; (3) platform gap analysis — identifies what the agent couldn't do because the catalog/tools lack the right capabilities. Output is a single critical prose document per session, "written as if by an extremely critical, well-informed reviewer."
- **Scenarios are creative briefs, not API docs.** Prompts describe what to create, never mention tool names. Agents discover tools via `catalogRead`. 14 scenarios spanning fully autonomous (ambient-art, devops-pipeline) to highly interactive (choose-your-adventure with simulated user). New requirements get new scenarios — existing ones are never overwritten.
- **Framework independence via abstraction boundaries.** The harness MCP coupling is localized to exactly 2 files:
  - `agent.ts:137-151` — `createMCP()` uses `Experimental_StdioMCPTransport` to spawn local server. Post-merge: replace with HTTP MCP client targeting `POST /stage/<uuid>/mcp/callTool`.
  - `scenario.ts:57-128` — `createWorkspace()` writes `.mcp.json` + `.claude/settings.json` for isolated agent workspace. Post-merge: no-op (dazzle pod is the workspace).
  - Post-merge, these become concrete implementations (no abstract interfaces needed until a second transport arrives):
    - **Agent transport**: HTTP MCP client via `@ai-sdk/mcp` or MCP SDK's `StreamableHTTPClientTransport`
    - **Video capture**: HLS segment download from `/stage/<uuid>/hls/stream.m3u8` (existing `handleStageProxy` route) + ffmpeg concat to MP4
    - **Scene observation**: MCP `get_script` polling at ~500ms interval
  - Everything else is fully decoupled: evaluation, replay, transcription, logging, session persistence.
- **Web build integration.** `shared/` imports work via path alias — add `@shared/*` to `web/tsconfig.json` paths and `web/vite.config.ts` resolve.alias. No workspace/monorepo setup needed. `web/tsconfig.json` include should add `"../shared"` for type checking. No new npm dependencies. **Import convention:** `web/` uses `.js` extensions on all TS imports (e.g., `import { Spec } from "@shared/core/spec.js"`). `harness/` uses extensionless imports with `tsx` runtime (e.g., `import { Spec } from "../../shared/core/spec"`). `shared/core/` internal imports use extensionless relative paths (e.g., `import { Spec } from "./spec"`).
- **Deprecations / Removals.**
  - `spawner.ts` — deleted (old Claude CLI mode with stream-json parsing, replaced by AI SDK callbacks)
  - `system-prompt.ts` — folded into agent.ts or scenario configs, then deleted
  - `video-capture.ts` — replaced entirely (Puppeteer → HLS download + ffmpeg)
  - `recorder.ts` — replaced entirely (WebSocket → MCP `get_script` polling)
  - **Puppeteer dependency removed** from `harness/package.json`
  - **`ws` dependency removed** from `harness/package.json`
  - Dynamic workspace creation in `scenario.ts` replaced with `createStage()` API call

## Implementation Plan

### Tasks

Tasks are ordered by dependency — lowest level first, integration last.

- [x] **Task 1: Create `shared/core/` directory with protocol types**
  - File: `shared/core/spec.ts` (copy from `stream/src/core/spec.ts`)
  - File: `shared/core/timeline.ts` (copy from `stream/src/core/timeline.ts`)
  - File: `shared/core/patch.ts` (copy from `stream/src/core/patch.ts`)
  - File: `shared/core/expressions.ts` (copy from `stream/src/core/expressions.ts`)
  - File: `shared/core/catalog.ts` (copy from `stream/src/core/catalog.ts`)
  - File: `shared/core/registry.ts` (copy from `stream/src/core/registry.ts`)
  - File: `shared/core/index.ts` (barrel export for all types)
  - File: `shared/tsconfig.json` (minimal TS config for the shared directory)
  - Action: Copy files, update internal imports between core modules to use relative paths within `shared/core/`. Remove any imports that reference `stream/src/server/` or other non-core modules. The `timeline.ts` imports from `./spec` — this stays as-is since both are in `shared/core/`.
  - Notes: These are pure types + a few utility functions (`emptySpec()`, `applyPatches()`). No runtime dependencies beyond TypeScript itself.

- [x] **Task 2: Configure `web/` to import from `shared/`**
  - File: `web/tsconfig.json`
  - Action: Add `"@shared/*": ["../shared/*"]` to `compilerOptions.paths`. Add `"../shared"` to `include` array.
  - File: `web/vite.config.ts`
  - Action: Add `"@shared": path.resolve(__dirname, "../shared")` to `resolve.alias`.
  - Notes: **tsconfig vs Vite alias syntax:** tsconfig uses `"@shared/*": ["../shared/*"]` (glob pattern with `/*`). Vite uses `"@shared": path.resolve(...)` (prefix match without `/*` — Vite's alias does prefix matching by default, so `@shared/core/spec` resolves to `../shared/core/spec`). These are intentionally different syntaxes for the same effect. Verify with `cd web && npm run build` — TypeScript compilation and Vite bundling must both resolve `@shared/core/*` imports.

- [x] **Task 3: Add timeline MCP tool definitions to web UI**
  - File: `web/src/components/onboarding/mcp-tools.ts`
  - Action: Add 4 timeline tool entries to the `MCP_TOOLS` array: `timelineAppend`, `timelinePlay`, `timelineRead`, `timelineClear`. Follow the existing pattern (id, name, description, params, example). Descriptions from `stream/src/server/tools.ts:231-283`.
  - Notes: These are static data entries for the onboarding UI documentation — no runtime behavior. **The tools don't exist in the Go control plane yet.** Gate these tools behind a `comingSoon: true` flag on each entry. The rendering component must check this flag and display them with a "Coming Soon" badge, visually distinct from live tools. Do NOT show them as available tools — users will try to call them and get errors.

- [x] **Task 4: Archive docs and research**
  - File: `docs/stream-research/` (new directory)
  - Action: Copy the following from `stream/`:
    - `SPEC.md` → `docs/stream-research/SPEC.md`
    - `RELOCATION_DOCUMENTATION.md` → `docs/stream-research/RELOCATION_DOCUMENTATION.md`
    - `DECLARATIVE_RENDERING_RESEARCH.md` → `docs/stream-research/DECLARATIVE_RENDERING_RESEARCH.md`
    - `docs/timeline-design.md` → `docs/stream-research/timeline-design.md`
    - `docs/agentic-broadcasting-spec.md` → `docs/stream-research/agentic-broadcasting-spec.md`
    - `docs/frontend-research.md` → `docs/stream-research/frontend-research.md`
    - `docs/distilled/` → `docs/stream-research/distilled/` (all 15 files)
    - `docs/research/` → `docs/stream-research/research/` (all 8 files)
    - `docs/relocation-history-context.md` → `docs/stream-research/relocation-history-context.md`
    - `harness/HARNESS_SPEC.md` → `docs/stream-research/HARNESS_SPEC.md`
  - Notes: Straight copy, no modifications. These are archived project knowledge.

- [x] **Task 5: Move harness structure and scenarios**
  - File: `harness/` (new top-level directory)
  - Action: Copy from `stream/harness/`:
    - `harness/run.ts`
    - `harness/lib/types.ts`
    - `harness/lib/agent.ts`
    - `harness/lib/evaluator.ts`
    - `harness/lib/logger.ts`
    - `harness/lib/replay.ts`
    - `harness/lib/scenario.ts`
    - `harness/lib/user-simulator.ts`
    - `harness/lib/video-transcriber.ts` (LLM-based video transcription via OpenRouter/Gemini — keep as-is)
    - `harness/scenarios/` (all 14 scenario directories with prompt.md, config.json, seed/, persona.md)
  - Action: Do NOT copy `spawner.ts`, `system-prompt.ts`, `video-capture.ts`, `recorder.ts` — these are being replaced.
  - Action: Create `harness/package.json` with dependencies: `@ai-sdk/anthropic`, `@ai-sdk/openai` (for OpenRouter/Gemini transcription), `@ai-sdk/mcp` (or `@modelcontextprotocol/sdk`), `zod`, `ai` (Vercel AI SDK core), `dotenv`. Do NOT include `puppeteer` or `ws`. Add scripts: `"run": "tsx run.ts"`, `"run:scenario": "tsx run.ts --scenario"`, `"typecheck": "tsc --noEmit"`. Add `tsx` as a devDependency.
  - Action: Create `harness/tsconfig.json` — extend from shared config pattern, include `"../shared"` for type resolution.
  - Action: Create `harness/.env.example` with required env vars: `DAZZLE_URL`, `DAZZLE_API_KEY`, `OPENROUTER_API_KEY` (optional), `GEMINI_API_KEY` (optional).
  - Notes: Fold `system-prompt.ts` content into `agent.ts` or scenario prompt loading. The `run.ts` imports `dotenv/config` on line 1 — `dotenv` must be in `package.json`.

- [x] **Task 6: Add `shared/core/` imports to harness files that need protocol types**
  - Notes: The existing harness files do NOT import from `stream/src/core/` — they currently have no protocol type imports at all. This task adds new imports where needed post-refactor:
  - File: `harness/lib/scene-observer.ts` (new, from Task 10) — will need `Spec` type from `../shared/core/spec` if parsing spec from script content
  - File: `harness/run.ts` — may need `Spec` or `TimelineEntry` imports if the run pipeline references protocol types directly
  - File: `harness/lib/agent.ts` — may need shared types if the system prompt includes catalog data from `shared/core/catalog.ts`
  - Action: After Tasks 7-10 are complete, grep all harness files for any references to protocol types (`Spec`, `UIElement`, `TimelineEntry`, `PatchOp`, etc.) and ensure they import from `../shared/core/`. If no harness file needs shared types directly (e.g., types only flow through MCP tool responses as opaque JSON), this task is a no-op — verify and document.

- [x] **Task 7: Refactor `agent.ts` — stdio to HTTP MCP transport**
  - File: `harness/lib/agent.ts`
  - Action: Replace `createMCP()` function (lines ~137-151):
    - Remove `Experimental_StdioMCPTransport` import and usage
    - Replace with HTTP MCP client that targets `POST ${dazzleUrl}/stage/${stageId}/mcp/callTool`
    - The MCP client should accept `dazzleUrl` and `apiKey` from environment or config
    - Tool discovery via `mcpClient.tools()` remains the same shape regardless of transport
    - Authentication: `Authorization: Bearer ${apiKey}` header on all requests
  - Action: Update `runAgent()` and `runInteractiveAgent()` to accept a `stageId` and `dazzleUrl` instead of `port`
  - Action: Remove `buildEnv()` function (no child process environment needed)
  - Action: Fold `system-prompt.ts` content into the prompt construction logic in agent.ts. **Preserve `buildSystemPrompt()` (lines 153-158)** — it handles `appendSystemPrompt` from scenario configs. This function already works and must not be deleted or overlooked during refactor.
  - Notes: Check if `@ai-sdk/mcp` exports an HTTP transport. If not, use `@modelcontextprotocol/sdk`'s `StreamableHTTPClientTransport`. The Vercel AI SDK's `experimental_createMCPClient` should work with either transport.

- [x] **Task 8: Refactor `scenario.ts` — workspace to stage creation**
  - File: `harness/lib/scenario.ts`
  - Action: Verify `loadScenario()` path resolution. It uses `path.resolve(process.cwd(), "harness/scenarios")` — this works when run from the monorepo root but fails if run from within `harness/`. Since `package.json` scripts use `tsx run.ts` (cwd = `harness/`), update `SCENARIOS_DIR` to `path.resolve(__dirname, "../scenarios")` for reliable resolution regardless of cwd.
  - Action: Replace `createWorkspace()` function (lines ~57-128):
    - Remove filesystem operations (mkdirSync, writeFileSync for .mcp.json and .claude/settings.json)
    - Replace with `createStage()` that calls the dazzle control plane API:
      1. `POST /api.v1.StageService/CreateStage` (ConnectRPC) with auth header
      2. Call `start` MCP tool to activate the stage
      3. Return `{ stageId, dazzleUrl }` instead of `{ workspacePath }`
    - Seed data upload: if scenario has `seedPath`, upload via `set_script` MCP tool after stage starts
  - Action: Add `destroyStage()` function that calls `stop` MCP tool then `DELETE /api.v1.StageService/DeleteStage`. This MUST be called in a `finally` block in `run.ts` — if the harness crashes or the agent errors, the stage must still be cleaned up. Log the stageId on creation so orphaned stages can be identified and manually cleaned via `make clean` if `destroyStage()` itself fails.
  - Notes: The control plane uses ConnectRPC (HTTP/2 RPC). Use `fetch` with JSON body, `Content-Type: application/json` header, and `Authorization: Bearer ${apiKey}` header (same `bstr_` prefixed API key used for MCP). ConnectRPC unary calls use `POST` with JSON request/response bodies. See `control-plane/mcp.go` for endpoint patterns and `control-plane/auth.go` for auth middleware.

- [x] **Task 9: Create HLS video capture module**
  - File: `harness/lib/hls-capture.ts` (new file)
  - Action: Implement HLS segment download + ffmpeg concatenation:
    1. `start(hlsUrl, outputDir, authHeader)` — begin polling `${hlsUrl}/stream.m3u8` for new segments
    2. Parse the m3u8 playlist, track segment sequence numbers
    3. Download each `.ts` segment as it appears, writing to `outputDir/segments/`
    4. Track last seen sequence number to detect missed segments — log warnings for gaps
    5. `stop()` — stop polling, write ffmpeg concat file listing all downloaded segments in order, run:
       `ffmpeg -f concat -safe 0 -i segments.txt -c copy -movflags +faststart output.mp4`
    6. Return path to MP4 file (or null if no segments captured)
  - Action: The HLS URL is `${dazzleUrl}/stage/${stageId}/hls/stream.m3u8` (proxied by control plane's existing `handleStageProxy` reverse proxy with Bearer auth via `authMiddlewareHTTP`)
  - Notes: HLS playlist has 1s segments, rolling 5-segment window (`-hls_list_size 5 -hls_flags delete_segments`). Segments are deleted after 5 seconds. Poll every 500ms. **Error handling:** If a segment download fails or a sequence number gap is detected, log a warning with the gap range but continue capturing — partial videos are acceptable (AC 12). Use `Authorization: Bearer ${apiKey}` header on all fetch requests to the proxy. ffmpeg is a system dependency — spawn via `child_process.execSync`.

- [x] **Task 10: Create MCP-based scene observer**
  - File: `harness/lib/scene-observer.ts` (new file)
  - Action: Implement scene state polling via MCP:
    1. `start(mcpClient)` — begin polling `get_script` tool every ~500ms
    2. Each response is the current panel script (JSX/JS string). Diff against previous to detect changes.
    3. Store snapshots with timestamp and mutation index (increment on each change detected via string comparison)
    4. `stop()` — halt polling
    5. `getSnapshots()` — return collected snapshots
  - Notes: The dazzle MCP tool is `get_script` (NOT `sceneRead` — that was the stream server's tool and does not exist on dazzle). `get_script` returns the raw script content as text. When SpecRenderer is in use, the script contains the Spec JSON embedded in JSX — the observer can extract the spec from the script if needed, or just store the raw script for diffing. The mutation index increments on each change detected (compare stringified content). This replaces the WebSocket-based `Recorder` class entirely. The `SceneSnapshot` type in `harness/lib/types.ts` may need updating to store script content instead of `SceneMessage`.

- [x] **Task 11: Update `run.ts` — integrate new capture and observation modules**
  - File: `harness/run.ts`
  - Action: Major refactor of the main run pipeline:
    1. Replace `createWorkspace()` with `createStage()` from refactored scenario.ts
    2. Replace `VideoCapture` (Puppeteer) with `HlsCapture` from new hls-capture.ts
    3. Replace `Recorder` (WebSocket) with `SceneObserver` from new scene-observer.ts
    4. Replace port-based addressing with `stageId` + `dazzleUrl` throughout
    5. Update session artifact paths — sessions still write to local filesystem (meta.json, replay.html, evaluation.md, etc.)
    6. Add `destroyStage()` call in the finally/cleanup block
    7. Update `SessionResult` references to remove `workspacePath` (or set to stageId for logging)
    8. Remove WebSocket-related imports
  - Action: Environment configuration — read from env vars:
    - `DAZZLE_URL` — control plane URL (e.g., `https://dazzle.fm` or `http://localhost:8080`)
    - `DAZZLE_API_KEY` — API key with `bstr_` prefix
  - Notes: The evaluation pipeline (`evaluator.ts`), replay generation (`replay.ts`), and logging (`logger.ts`) take `SessionResult` as input and don't touch MCP — they should work unchanged. Video transcription may need updating if it relied on Puppeteer's console output for error capture — check and route `get_logs` MCP tool output instead.

- [x] **Task 12: Add SpecRenderer to streamer pod + update scenario configs**
  - **12a: SpecRenderer component as separate streamer module**
    - File: `streamer/spec-renderer.js` (new file — NOT in `prelude.js`)
    - Action: Create a `SpecRenderer` React component that takes a `Spec` object and renders it as JSX:
      1. Walks `spec.elements` starting from `spec.root`
      2. Maps each element's `type` to a React component from a registry
      3. Resolves `$state` bindings against `spec.state`
      4. Renders `children` recursively by key lookup
      5. Exposes `window.SpecRenderer` as a global via `Object.assign(window, { SpecRenderer })`
    - File: `streamer/shell.html`
    - Action: Add `<script type="module" src="./spec-renderer.js"></script>` after the prelude script tag (line 88) and before `main.jsx` (line 89). This ensures React globals are available when SpecRenderer loads.
    - File: `streamer/docker/Dockerfile`
    - Action: Add `spec-renderer.js` to the COPY line (line 65) alongside `prelude.js`.
    - **Why not prelude.js:** The prelude is a 20-line bootstrap file that assigns React/Zustand to `window`. SpecRenderer is a substantial React component with a type registry, expression resolver, and recursive renderer — it belongs in its own module. The prelude pattern is imports + `Object.assign(window, ...)`, not component definitions.
    - **Integration with auto-mount:** The streamer's `index.js:177` auto-mounts any `App` component defined in user scripts. When agents use SpecRenderer, their `set_script` defines `const App = () => <SpecRenderer spec={spec} />` — the existing auto-mount picks it up. No changes to `index.js` needed.
    - **Day-one scope: 6 core components only.** Implement: `Box` (div container), `Stack` (flex column/row with gap), `Text` (paragraph with variant styling), `Heading` (h1-h6), `Card` (bordered container with title), `Image` (img with fit modes). All other types fall back to a generic `<div>` that renders children and applies `style` prop.
    - **AC for SpecRenderer:** AC 13 (below) — SpecRenderer must render a basic Spec with the 6 core components correctly.
    - Notes: The full 31-component catalog is a follow-up. The registry pattern from `shared/core/registry.ts` defines how type→component mapping works. The fallback div ensures unknown types don't crash rendering — they just render as unstyled containers. The `$state` resolution logic is in `shared/core/expressions.ts` (~50 lines) — port the logic inline (the streamer can't import from `shared/` since it's plain JS, not TS with path aliases).
  - **12b: Spec-based `set_script` pattern**
    - Action: The harness agent sends specs via `set_script` as JSX that uses the global `SpecRenderer`:
      ```jsx
      const spec = { root: "main", elements: { ... }, state: { ... } };
      const App = () => <SpecRenderer spec={spec} />;
      ```
    - Notes: This bridges the declarative scene spec model to dazzle's script-based rendering. The agent thinks in specs (token-efficient, composable), and dazzle renders them as React. No scenario prompts need rewriting.
  - **12c: Update scenario configs**
    - File: `harness/scenarios/*/config.json` (all 14 scenarios)
    - Action: Update `allowedTools` arrays from `mcp__stream__*` prefix to dazzle tool names. The mapping:
      - `sceneSet` → `set_script` (wrapping spec in `<SpecRenderer spec={...} />`)
      - `scenePatch` → `edit_script` (for incremental changes) or `set_script` (full replacement)
      - `sceneRead` → `get_script`
      - `screenshotTake` → `screenshot`
      - `catalogRead` → embed catalog as a static JSON block in the agent's system prompt (loaded from `shared/core/catalog.ts` at harness startup). No MCP tool needed — the catalog is context, not runtime state.
      - `stateSet` → no direct dazzle equivalent. State mutation is handled by sending a full spec via `set_script` with updated `state` values, or via `edit_script` to surgically modify state in the existing script. Remove from `allowedTools` — agents modify state through the spec itself.
      - `validateSpec` → no dazzle equivalent. Remove from `allowedTools`. Validation was a stream-server convenience tool; agents should rely on SpecRenderer's fallback rendering (unknown types render as `<div>`) and `screenshot` to visually confirm output.
    - Notes: Scenario `prompt.md` files should NOT need changes — they describe creative intent, not tool mechanics. The harness agent adapter layer handles the spec→set_script translation. The `allowedTools` arrays shrink from 11 tools to ~5 (`set_script`, `edit_script`, `get_script`, `screenshot`, plus timeline tools when available).

- [x] **Task 13: Verify end-to-end**
  - Action: Run `cd harness && npm install` — install all dependencies from the new `package.json`. Verify lockfile is generated.
  - Action: Run `cd web && npm run build` — verify shared type imports resolve
  - Action: Run `cd harness && npx tsc --noEmit` — verify harness TypeScript compiles
  - Action: Run hello-world scenario against dazzle cluster:
    1. Set `DAZZLE_URL` and `DAZZLE_API_KEY` env vars
    2. Execute harness with hello-world scenario
    3. Verify: stage created, agent runs, HLS captured, MP4 produced, evaluation runs, artifacts written
  - Action: Run at least 2 additional scenarios (e.g., `ambient-art`, `cinematic-broadcast`) to validate the tool mapping and SpecRenderer work beyond the trivial case. Log any scenario-specific failures as known issues.
  - Notes: First run will establish new baselines. Previous scores (6.5/10) are not directly comparable since the renderer changed. All 14 scenarios should eventually pass, but this task gates on hello-world + 2 others. Remaining scenario validation is follow-up work.

## Acceptance Criteria

- [x] **AC 1:** Given `shared/core/` exists with all protocol types, when `web/` imports `@shared/core/spec` and `@shared/core/timeline`, then `cd web && npm run build` succeeds with no type errors.

- [x] **AC 2:** Given `shared/core/` exists, when `harness/` imports from `shared/core/`, then `cd harness && npx tsc --noEmit` succeeds with no type errors.

- [x] **AC 3:** Given timeline tool definitions added to `web/src/components/onboarding/mcp-tools.ts` with `comingSoon: true`, when the web dashboard renders the MCP tools section, then `timelineAppend`, `timelinePlay`, `timelineRead`, and `timelineClear` appear with correct descriptions, parameter documentation, and a visible "Coming Soon" badge. They must NOT be presented as currently available tools.

- [x] **AC 4:** Given `DAZZLE_URL` and `DAZZLE_API_KEY` are set, when the harness runs `createStage()`, then a dazzle stage is created via the control plane API and the `start` tool activates the pod.

- [x] **AC 5:** Given an active dazzle stage, when the harness agent calls MCP tools (e.g., `set_script`, `screenshot`), then tool calls route through `POST /stage/<uuid>/mcp/callTool` with Bearer auth and return valid responses.

- [x] **AC 6:** Given an active dazzle stage producing HLS output, when `HlsCapture` runs, then it downloads m3u8 segments, stitches them to MP4 via ffmpeg, and produces a valid video file in the session output directory.

- [x] **AC 7:** Given an active dazzle stage, when `SceneObserver` polls `get_script` via MCP, then it captures scene state changes as `SceneSnapshot[]` compatible with existing evaluation and replay pipelines.

- [x] **AC 8:** Given a completed harness run with video + scene snapshots, when the evaluator runs, then it produces an evaluation markdown document with multi-pass analysis (blind critic, task completion, gap analysis).

- [x] **AC 9:** Given a completed harness run, when `destroyStage()` is called in cleanup, then the dazzle pod is stopped and the stage is deleted via the control plane API.

- [x] **AC 10:** Given `docs/stream-research/` exists, when a developer looks for protocol research, distilled requirements, or scenario design context, then all 15 distilled docs, 8 research docs, relocation docs, and specs are available under `docs/stream-research/`.

- [x] **AC 11 (error handling):** Given `DAZZLE_URL` is unreachable or `DAZZLE_API_KEY` is invalid, when the harness attempts to create a stage, then it fails fast with a clear error message (not a timeout or silent hang).

- [x] **AC 12 (edge case):** Given HLS segments are being captured and the agent finishes early (stage stops producing segments), when `HlsCapture.stop()` is called, then all downloaded segments are stitched to MP4 without data loss — partial captures produce partial videos, not failures.

- [x] **AC 13 (SpecRenderer):** Given a Spec object with elements using the 6 core types (Box, Stack, Text, Heading, Card, Image), when rendered via `<SpecRenderer spec={spec} />` on a dazzle stage, then all elements render visually (no blank screen, no React errors in console). Unknown element types render as generic `<div>` containers without crashing.

## Additional Context

### Dependencies

- `shared/` — no dependencies, pure TypeScript types and utilities
- `harness/` — own `package.json` with: Vercel AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/openai`), `@ai-sdk/mcp` or `@modelcontextprotocol/sdk` (HTTP client transport), `zod`, `dotenv`, `tsx` (devDependency). **Removed**: Puppeteer, `ws`. ffmpeg required as system dependency (already available on dev machines and in streamer pods).
- `web/` — no new dependencies for this spec (timeline tools are static data in `mcp-tools.ts`)

### Testing Strategy

- `npm run build` in `web/` must pass with shared type imports from `shared/core/`
- Harness smoke test: create stage via dazzle API, run `hello-world` scenario via MCP, verify artifacts produced
- No new unit test framework required (per project rules)

### Notes

- The `stream/` repo has baseline scores (hello-world: 6.5/10, cinematic-broadcast: 3/10) — post-merge baselines will differ since the harness targets dazzle (different renderer), but scenario definitions carry over. These baselines exist to measure whether migration makes things better or worse.
- All of Conner's research and distilled docs carry over as archived project knowledge under `docs/stream-research/`. Key docs: 588-line relocation history context, agentic broadcasting spec, declarative rendering research (~1253 lines), 15 distilled requirement docs (2,493 lines), 8 research docs.
- The protocol is explicitly open to radical change — Remotion, templates, ACP, audio are all active research directions. The `shared/` types will evolve.
- Party mode refinements (round 1): harness-as-MCP-client, shared contract types, no stream server carry-over.
- Party mode refinements (round 2): pure MCP client (no direct pod connections), HLS video capture (no Puppeteer), `get_script` polling (no WebSocket recorder), Puppeteer+ws dependencies removed, no abstract interfaces until second transport needed, single-phase delivery validated against running dazzle cluster.
- **Terminology:** "Stage" = dazzle platform concept (a running pod with an ID, created via control plane API). "Session" = harness concept (one evaluation run: agent + stage + capture + evaluation, producing artifacts). A harness session creates a stage, runs an agent against it, evaluates the output, then destroys the stage. They are 1:1 but not interchangeable terms.

### Known Problems (from stream/ development, inform harness design)

- Agents consistently misuse JSON Patch semantics (children array corruption) — #1 runtime error category
- Imperative set/patch model is fundamentally error-prone for LLMs — driving the declarative pivot
- Cinematic output quality is poor — agents struggle with visual composition at scale
- Dead air between scenes — agent thinking time (10-15s) creates gaps
- Font sizing/scaling issues in headless Chrome — gradient text invisible
- No animation system in current catalog — static renders only

### Active Research Directions (carried over, not implemented)

| Direction | Status | Key Insight |
| --------- | ------ | ----------- |
| Remotion | Promising but undecided | `@remotion/player` is real-time; frame-based rendering means visual state = pure function of (frame, inputProps) |
| Template system | 7 types designed, not built | Title Card, Data Reveal, Split Comparison, Data Dashboard, Lower Third, Breaking Alert, Closing Summary — covers ~80% of broadcast use cases |
| json-render patterns | Validated architecture | Independently arrived at near-identical design to current Spec model. Has features we lack: conditional visibility, event handling, repeat/list rendering |
| ACP / multi-agent | Research only | Agents consuming other agents' streams; "Iran + AI + politics = news stream" |
| Audio | Research only | TTS narration (~$0.08/hr), background music, sound design |
| Protocol reduction | Recommended | 11 MCP tools → ~4: `catalogRead`, `sceneSet`, `sceneAppend`, `screenshotTake` |
| Expression system | Partially built | `$state` bindings work; planned: `$cond`/`$then`/`$else`, `$item`/`$index` for repeat rendering |

## Review Notes
- Adversarial review completed
- Findings: 13 total, 7 fixed, 6 skipped (noise/inherent)
- Resolution approach: auto-fix
- Fixed: F1 (poll race in HLS), F3 (tool result matching), F7 (poll race in SceneObserver), F9 (lazy OpenRouter init), F10 (stop() await in-flight poll), F11 (use shared applyPatches)
- Skipped: F2 (noise — AI SDK handles tools without execute), F4 (inherent — Google API pattern), F5 (acknowledged — video memory usage, acceptable for now), F6 (noise — tsx provides __dirname), F8 (noise — prelude.js load order), F12/F13 (noise — latent edge cases)
