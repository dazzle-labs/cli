# Runtime & Harness - Deep Dive Documentation

**Generated:** 2026-03-05
**Scope:** `runtime/` + `harness/`
**Files Analyzed:** ~65 source files (52 runtime + 13 harness lib/entry) + 14 scenarios
**Lines of Code:** ~7,500 (runtime ~2,700 + harness ~4,800)
**Workflow Mode:** Exhaustive Deep-Dive

## Overview

The **runtime** and **harness** are the two newest major subsystems in Browser Streamer. Runtime provides the browser-side rendering engine — a spec-driven, declarative scene graph rendered by React 19 with 37 broadcast-quality components, a timeline system, and a JSON Patch state model. Harness is the evaluation framework that orchestrates AI agents against scenarios, captures their output (video + scene mutations), evaluates quality via multimodal LLM, and generates interactive replay files.

**Purpose:** Together they form the "content creation and quality" layer — runtime defines *what can be rendered*, harness tests *how well agents render it*.

**Key Responsibilities:**
- Runtime: Render spec-driven scenes in Chrome, manage timeline playback, resolve state expressions, provide component catalog for LLM agent guidance
- Harness: Run AI agents against scenarios, capture HLS video + scene snapshots, transcribe video, evaluate output quality, generate replay.html files

**Integration Points:** Runtime core types (`Spec`, `PatchOp`, `TimelineEntry`) are shared between both systems. Harness imports `applyPatches` and `PatchOp` from `runtime/core/`. Control-plane loads `renderer.js` and serves it to streamer pods. Streamer's `shell.html` loads the compiled bundles.

---

## Complete File Inventory

---

### runtime/core/spec.ts

**Purpose:** Defines the core data model — `Spec` (the scene graph), `UIElement` (individual elements), `PatchOp` (RFC 6902 JSON Patch operations), and `WSMessage` (WebSocket wire protocol).
**Lines of Code:** 35
**File Type:** TypeScript (pure types + one factory function)

**What Future Contributors Must Know:** This is the single source of truth for the entire rendering pipeline. Every scene is a `Spec` with a flat `elements` map (not a tree), a `root` pointer, and a `state` bag. Changes flow as `PatchOp[]` arrays. The `WSMessage` union covers all wire-protocol message types including timeline operations.

**Exports:**
- `Spec` (interface) — `{ root: string, elements: Record<string, UIElement>, state: Record<string, unknown> }`
- `UIElement` (interface) — `{ type: string, props: Record<string, unknown>, children?: string[], slot?: string }`
- `PatchOp` (type) — Union of add/replace/remove operations with `op`, `path`, `value`
- `WSMessage` (type) — Discriminated union: snapshot, patch, timeline-entry, timeline-play, timeline-clear, timeline-snapshot, agent-status
- `emptySpec(): Spec` — Factory for blank spec

**Dependencies:** Imports `TimelineEntry`, `TimelinePlayback`, `Timeline` from `./timeline`

**Used By:** `runtime/core/patch.ts`, `runtime/core/expressions.ts`, `runtime/core/catalog.ts`, `runtime/renderer.tsx`, `harness/lib/evaluator.ts`, `harness/lib/replay.ts`

**Patterns Used:** Discriminated union for wire protocol, flat element map (not tree) for O(1) element access

**State Management:** Defines the state model (`Spec.state`) but doesn't manage it

**Side Effects:** None

**Error Handling:** None needed (pure types)

**Testing:** No test files found

---

### runtime/core/patch.ts

**Purpose:** Applies RFC 6902 JSON Patch operations to Spec objects. Deep-clones before mutation to preserve immutability. Includes an auto-correction guard for a common agent mistake (writing a string to an array path).
**Lines of Code:** 70
**File Type:** TypeScript

**What Future Contributors Must Know:** The `applyPatches` function is the ONLY approved way to mutate a Spec. It always returns a deep clone via `structuredClone`. The "add" operation has a special guard: if the target is an array and the value is a primitive, it appends instead of replacing — this fixes a frequent agent error where they write `{ path: "/elements/x/children", value: "childId" }` intending to append.

**Exports:**
- `applyPatches<T>(obj: T, patches: PatchOp[]): T` — Deep-clone + apply patches

**Dependencies:** `PatchOp` from `./spec`

**Used By:** `runtime/renderer.tsx` (scene:patch and timeline fireEntry), `harness/lib/evaluator.ts` (resolveAllSpecs), `harness/lib/replay.ts` (spec resolution)

**Key Implementation Details:**
```typescript
// Auto-correct: if target is an array and value is a primitive, append instead of replace
const existing = parent[key]
if (Array.isArray(existing) && !Array.isArray(op.value) && typeof op.value !== "object") {
  existing.push(op.value)
} else {
  parent[key] = op.value
}
```
The `resolve()` helper walks a JSON Pointer path (RFC 6901) to find the parent object and final key.

**Patterns Used:** Immutable update via structuredClone, JSON Pointer resolution

**Side Effects:** None (pure function)

**Error Handling:** Throws on unresolvable paths

**Testing:** No test files found

---

### runtime/core/expressions.ts

**Purpose:** Resolves `$state` expressions in element props against the spec's state bag. Enables reactive data binding — an element prop can reference `{ "$state": "/metrics/cpu" }` and it will be resolved to the current value at that JSON Pointer path in `spec.state`.
**Lines of Code:** 50
**File Type:** TypeScript

**What Future Contributors Must Know:** Currently V1 — only `$state` expressions are supported. Future planned: `$cond`, `$template`, `$computed`. Expression resolution is recursive (handles nested objects and arrays). The resolver is called on every render for every element.

**Exports:**
- `resolveExpressions(props: Record<string, unknown>, state: Record<string, unknown>): Record<string, unknown>` — Resolve all expressions in a props object

**Dependencies:** None

**Used By:** `runtime/renderer.tsx` (RenderElement component)

**Key Implementation Details:**
- Detects `{ "$state": "/json/pointer/path" }` objects
- Walks JSON Pointer path via `getByPointer()`
- Recursively resolves nested objects and arrays
- Returns resolved copy (does not mutate input)

**Patterns Used:** JSON Pointer (RFC 6901), recursive visitor pattern

**Side Effects:** None (pure function)

---

### runtime/core/timeline.ts

**Purpose:** Defines the timeline data model — entries (keyframes at specific elapsed times), playback state, and transition specifications. The timeline enables pre-recorded or scripted sequences of scene changes.
**Lines of Code:** 58
**File Type:** TypeScript (pure types)

**What Future Contributors Must Know:** A `TimelineEntry` has an `at` (elapsed ms) and an `action` (snapshot, patch, or stateSet). Entries are sorted by `at` ascending. The `TransitionSpec` supports cut, crossfade, and CSS transitions — but only "cut" is currently implemented in the renderer. `TimelinePlayback` tracks play/pause/stop with wall-clock math for elapsed time.

**Exports:**
- `TransitionSpec` (interface) — `{ duration?, easing?, type?: "cut" | "crossfade" | "css" }`
- `TimelineEntry` (interface) — `{ at: number, action: snapshot|patch|stateSet, transition?, label? }`
- `TimelinePlayback` (interface) — `{ state: "stopped"|"playing"|"paused", rate: number, startedAt?, offsetMs? }`
- `Timeline` (interface) — `{ entries: TimelineEntry[], duration?, playback: TimelinePlayback }`

**Dependencies:** `Spec`, `PatchOp` from `./spec`

**Used By:** `runtime/renderer.tsx` (timeline state machine), `runtime/core/spec.ts` (WSMessage types)

---

### runtime/core/catalog.ts

**Purpose:** Defines the component catalog system — a Zod-validated registry of available components with their prop schemas, descriptions, and categories. The catalog generates LLM-facing prompts (design principles + component docs) and validates specs against schemas.
**Lines of Code:** 359
**File Type:** TypeScript

**What Future Contributors Must Know:** This is the LLM's "design education." The `prompt()` method generates a comprehensive markdown guide with broadcast design principles (1920x1080 canvas, font sizing rules, color guidance, animation best practices) plus full component documentation. The `validate()` method can auto-fix missing required props by inferring defaults from Zod schemas. State expressions (`$state`) are skipped during validation.

**Exports:**
- `CatalogEntry` (interface) — `{ props: z.ZodType, description?, hasChildren?, slots?, category? }`
- `ValidationIssue` (interface) — `{ elementKey, type, message, fix? }`
- `ValidationResult` (interface) — `{ valid, issues[], fixed? }`
- `Catalog` (interface) — `{ components, prompt(), index(), categoryDetail(), componentDetail(), validate() }`
- `defineCatalog(components): Catalog` — Factory for creating catalogs

**Dependencies:** `zod`, `Spec` from `./spec`

**Used By:** `runtime/core/registry.ts`, `runtime/generate-catalog.ts` (via stream catalog), control-plane MCP tools (catalog-index.md and catalog-full.md)

**Key Implementation Details:**
- `prompt()` — Full markdown with design principles, spec format, and all component props
- `index()` — Compact component index grouped by category
- `categoryDetail(category)` / `componentDetail(name)` — Detailed per-category/component schemas
- `validate(spec, autoFix?)` — Validates elements against Zod schemas; auto-fixes missing required props

**Patterns Used:** Zod schema introspection, factory pattern, auto-fix with default inference

---

### runtime/core/registry.ts

**Purpose:** Maps catalog component names to React component implementations. Used by the renderer to look up the actual React component for each element type.
**Lines of Code:** 35
**File Type:** TypeScript

**Exports:**
- `RegistryComponent` (interface) — `{ component: ComponentType<{props, children?}> }`
- `Registry` (type) — `Record<string, RegistryComponent>`
- `defineRegistry(catalog, implementations): Registry` — Creates registry with console warnings for missing implementations

**Dependencies:** `ComponentType` from React, `Catalog` from `./catalog`

**Used By:** Not currently used in renderer (renderer uses a direct COMPONENTS map instead)

---

### runtime/core/index.ts

**Purpose:** Barrel file re-exporting all core types and functions.
**Lines of Code:** 19

**Exports:** Re-exports `Spec`, `UIElement`, `PatchOp`, `WSMessage`, `emptySpec`, `TransitionSpec`, `TimelineEntry`, `TimelinePlayback`, `Timeline`, `applyPatches`, `resolveExpressions`, `CatalogEntry`, `ValidationIssue`, `ValidationResult`, `Catalog`, `defineCatalog`, `RegistryComponent`, `Registry`, `defineRegistry`

---

### runtime/renderer.tsx

**Purpose:** The browser-side rendering engine. Mounts a React app driven by a Zustand store, listens for `CustomEvent`s dispatched by the streamer's Vite HMR system, and renders the current scene spec using the component registry. Also implements the full timeline playback state machine.
**Lines of Code:** 283
**File Type:** TSX

**What Future Contributors Must Know:** This file is loaded as an IIFE bundle (`renderer.js`) after `prelude.js` sets up React/Zustand globals. It uses `window.addEventListener("event", ...)` to receive scene/timeline commands via CustomEvent. The Zustand store (`useSceneStore`) holds the current `Spec`. Timeline state is managed outside React in a plain object (`timelineState`) with `setTimeout`-based scheduling. Two globals are exposed for CDP eval: `window.__sceneSpec()` and `window.__timelineState()`.

**Exports:** None (IIFE — side-effect only)

**Dependencies:**
- `applyPatches` from `./core/patch`
- `resolveExpressions` from `./core/expressions`
- `Spec`, `PatchOp` from `./core/spec`
- `TimelineEntry`, `TimelinePlayback`, `Timeline` from `./core/timeline`
- All 37 components from `./components`
- Globals: `React`, `createElement`, `create`, `createRoot` from prelude

**Key Implementation Details:**

**Zustand Store:**
```typescript
const useSceneStore = create<SceneStore>((set) => ({
  spec: { root: "", elements: {}, state: {} },
  setSpec: (spec: Spec) => set({ spec }),
}))
```

**Event Handlers (6 events):**
- `scene:snapshot` — Full spec replacement
- `scene:patch` — Apply PatchOp[] to current spec
- `scene:stateSet` — Update a single state path (converted to a replace patch)
- `timeline:append` — Add entries, sort by `at`, fire past entries if playing
- `timeline:play` — Play/pause/stop with seek support, wall-clock elapsed math
- `timeline:clear` — Reset timeline completely

**Timeline State Machine:**
- `getElapsed()` — Computes elapsed ms accounting for rate, pause offset, wall-clock
- `scheduleNext()` — Sets timeout for next entry based on delay/rate
- `fireEntry()` — Applies snapshot/patch/stateSet to Zustand store
- `firePastEntries()` — On play/seek, fast-forwards from last snapshot to cursor

**React Tree:** `App` → `SpecRenderer` → `RenderElement` (recursive). Each element resolves expressions, looks up component, renders children recursively.

**Patterns Used:** Zustand store, CustomEvent listener, recursive rendering, setTimeout-based timeline scheduler

**Side Effects:** Global event listeners, React root mount, window globals (`__sceneSpec`, `__timelineState`)

---

### runtime/prelude.ts

**Purpose:** Bundles React 19, ReactDOM, and Zustand as browser globals on `window`. Loaded before renderer.js so all React APIs are available without imports.
**Lines of Code:** 27
**File Type:** TypeScript

**What Future Contributors Must Know:** This creates the runtime environment. All React hooks, utilities, and Zustand's `create`/`persist` are exposed as window globals. The renderer.tsx declares these as `declare const` and uses them directly. If you add a new React API, you must add it here AND rebuild prelude.js.

**Exports:** None (IIFE — side-effect only, assigns to `window`)

**Window Globals Set:**
`React`, `createElement`, `createRoot`, `useState`, `useEffect`, `useRef`, `useMemo`, `useCallback`, `useReducer`, `Fragment`, `useContext`, `useLayoutEffect`, `useImperativeHandle`, `useDebugValue`, `useDeferredValue`, `useTransition`, `useId`, `useSyncExternalStore`, `createContext`, `forwardRef`, `memo`, `lazy`, `Suspense`, `createPortal`, `create`, `persist`

**Dependencies:** `react`, `react-dom/client`, `react-dom`, `zustand`, `zustand/middleware`

---

### runtime/components/ (37 components)

All components follow a uniform pattern:
- Accept `{ props, children? }` where `props` is a `Record<string, unknown>`
- Destructure specific props with defaults from `props`
- Accept optional `style` override
- Return JSX (no hooks except Presence, Ticker which use useState/useEffect/useId)

#### Layout (6)

| Component | LOC | Purpose | Children |
|-----------|-----|---------|----------|
| **Box** | 9 | Generic container, no default styling | Yes |
| **Stack** | 37 | Flexbox container with direction, gap, align, justify | Yes |
| **Grid** | 22 | CSS Grid with columns, rows, gap | Yes |
| **Split** | 30 | Two-pane layout with ratio (e.g. "2/1"), direction | Yes (2) |
| **Gradient** | 39 | Linear/radial/conic gradient backgrounds | Yes |
| **Overlay** | 29 | Absolute-positioned container with position presets (corners, center, full) | Yes |

#### Text (3)

| Component | LOC | Purpose | Children |
|-----------|-----|---------|----------|
| **Heading** | 33 | h1-h6 with broadcast sizing (96px down to 24px) | No |
| **Text** | 45 | Body/caption/label/mono variants (28px/20px/18px/24px) | No |
| **Code** | 41 | Monospace code block with optional title | No |

#### Content (3)

| Component | LOC | Purpose | Children |
|-----------|-----|---------|----------|
| **Card** | 49 | Container with optional header (title/subtitle) | Yes |
| **Image** | 15 | Image element with object-fit control | No |
| **Divider** | 17 | Horizontal/vertical dividing line | No |

#### Broadcast (4)

| Component | LOC | Purpose | Children |
|-----------|-----|---------|----------|
| **LowerThird** | 41 | Broadcast-style name/title/subtitle with accent bar | No |
| **Ticker** | 64 | Scrolling news ticker with speed control, urgent items | No |
| **Banner** | 32 | Full-width alert banner with severity colors | No |
| **Badge** | 33 | Inline colored badge (default/success/warning/error/info) | No |

#### SVG (4)

| Component | LOC | Purpose | Children |
|-----------|-----|---------|----------|
| **Shape** | 49 | Basic SVG shapes (rect, circle, ellipse, polygon) | No |
| **Line** | 34 | SVG line with stroke, dashing | No |
| **Path** | 17 | Custom SVG path element | No |
| **SvgContainer** | 19 | SVG wrapper with viewBox | Yes |

#### Animation (6)

| Component | LOC | Purpose | Children |
|-----------|-----|---------|----------|
| **Transition** | 19 | CSS transition wrapper for smooth property changes | Yes |
| **FadeIn** | 20 | Simple fade-in animation | Yes |
| **Counter** | 21 | Numeric display with prefix/suffix | No |
| **Animate** | 64 | CSS keyframe animations (9 presets: fade-in, slide-in-*, scale-*, bounce-in, pulse) | Yes |
| **Stagger** | 50 | Sequential child animations with interval delay | Yes |
| **Presence** | 85 | Mount/unmount with enter/exit animations (6 enter + 6 exit presets) | Yes |

#### Data (5)

| Component | LOC | Purpose | Children |
|-----------|-----|---------|----------|
| **Stat** | 45 | Large metric with unit, label, trend indicator | No |
| **ProgressBar** | 45 | Animated progress bar with label and percentage | No |
| **Sparkline** | 47 | Compact SVG line chart with optional fill | No |
| **Chart** | 292 | Full chart (bar, line, area, point, pie, donut) with SVG rendering | No |
| **Table** | 97 | Data table with columns, sorting, striped rows, compact mode | No |

#### Coding (6)

| Component | LOC | Purpose | Children |
|-----------|-----|---------|----------|
| **StatusBar** | 73 | Header bar with title, detail, stats | No |
| **CodeView** | 72 | Code display with line numbers and highlighting | No |
| **DiffView** | 75 | Unified diff with color-coded additions/removals | No |
| **TerminalView** | 50 | Terminal command display with exit code | No |
| **EventTimeline** | 121 | Scrollable event timeline with type-based colors | No |
| **ProgressPanel** | 52 | Task list with status indicators (planned/active/done) | No |

---

### runtime/generate-catalog.ts

**Purpose:** Generates static catalog text files (`dist/catalog-index.md` and `dist/catalog-full.md`) from the general catalog definition. These files are bundled into a K8s ConfigMap and served to agents via MCP.
**Lines of Code:** 26
**File Type:** TypeScript (Node.js script)

**What Future Contributors Must Know:** This imports from `../stream/src/catalogs/general/catalog` — a sibling `stream/` directory that is being merged into this repo. If that import path changes, this script and `watch.mjs` must be updated.

**Dependencies:** `fs`, `path`, `../stream/src/catalogs/general/catalog`

**Side Effects:** Writes `dist/catalog-index.md` and `dist/catalog-full.md`

---

### runtime/watch.mjs

**Purpose:** Development watch mode — runs esbuild in watch mode for both prelude and renderer bundles, and watches catalog sources for regeneration.
**Lines of Code:** 97
**File Type:** ESM JavaScript

**What Future Contributors Must Know:** Watches 3 catalog source paths (including `../stream/` paths). Debounces catalog rebuilds by 300ms. The prelude and renderer use different esbuild configs (renderer has `external: ["react", "react-dom", "zustand"]` since it uses prelude globals).

**Dependencies:** `esbuild`, `child_process`, `fs`, `path`

**Side Effects:** Filesystem watchers, esbuild watch contexts, process signal handler

---

### runtime/package.json

**Purpose:** Package config for @browser-streamer/runtime.
**Key Details:**
- `type: "module"` (ESM)
- Scripts: `build:prelude` (esbuild IIFE), `build:renderer` (esbuild IIFE, React external), `build` (both), `watch`
- Dependencies: react ^19.2.4, react-dom ^19.2.4, zustand ^5.0.11
- DevDependencies: esbuild ^0.25.0, typescript ^5.7.0

---

### runtime/tsconfig.json

**Purpose:** TypeScript config — ES2020 target, classic JSX mode (`"jsx": "react"` — uses `React.createElement`), bundler module resolution.

---

## Harness File Inventory

---

### harness/lib/types.ts

**Purpose:** Core type definitions for the entire harness system — sessions, scenarios, stream events, tool calls, and evaluation results.
**Lines of Code:** 123

**Exports:**
- `ToolCall` — `{ timestamp, tool, args, result }`
- `SceneMessage` — Wire-format scene (type + spec/patches)
- `SceneSnapshot` — Scene message with timestamp and mutation index
- `UserMessage` — User content with timestamp
- `SessionResult` — Complete session record (scenario, sessionId, stageId, times, toolCalls[], sceneSnapshots[], exitCode, evaluation/video/transcription paths, screenshots, console errors)
- `ScenarioConfig` — `{ name, promptPath, seedPath, interactive, userPersona, allowedTools[], model, effort, appendSystemPrompt }`
- `SessionMeta` — Summary stats (duration, counts, paths)
- `EvaluationResult` — `{ rawOutput: string }`
- Stream event types: `StreamEventBase`, `ThinkingEvent`, `ToolCallEvent`, `ToolResultEvent`, `TextEvent`, `SystemEvent`
- `StreamEvent` — Discriminated union of all event types

**Dependencies:** None (pure types)

---

### harness/lib/agent.ts

**Purpose:** Claude agent orchestration. Two modes: standard (streaming text with MCP tools) and interactive (multi-turn with user simulator). Provides built-in `wait` and `done` tools.
**Lines of Code:** 404

**Exports:**
- `AgentCallbacks` (interface) — onToolCall, onToolResult, onThinking, onText, onStepFinish
- `AgentOptions` (interface) — stageId, dazzleUrl, apiKey, model, thinkingBudget, maxSteps, systemPrompt, appendSystemPrompt, callbacks
- `AgentResult` (interface) — toolCalls[], text, steps, finishReason, usage
- `InteractiveAgentOptions` (extends AgentOptions) — userPersona, getLatestScene, maxTurns, simulatorCooldownMs
- `runAgent(prompt, options): Promise<AgentResult>` — Standard streaming mode
- `runInteractiveAgent(prompt, options): Promise<AgentResult>` — Interactive multi-turn mode

**Dependencies:** `@ai-sdk/mcp`, `ai` (streamText, generateText, tool, hasToolCall, stepCountIs), `@ai-sdk/anthropic`, `zod`, `./types`, `./user-simulator`

**Key Tools Defined:**
- `waitTool` — Sleep 0.5-10 seconds (Zod-validated)
- `doneTool` — Signal completion (stops via `hasToolCall` before execution)

**Patterns Used:** MCP client factory, streaming AI SDK, Zod tool schemas

---

### harness/lib/evaluator.ts

**Purpose:** AI-powered multimodal evaluation of session results. Resolves spec evolution by replaying patches, builds comprehensive evaluation prompts with timing analysis and workflow metrics, calls Claude Opus 4.6 with screenshots.
**Lines of Code:** 806

**Exports:**
- `evaluate(result: SessionResult, outputDir: string): Promise<void>`

**Dependencies:** `fs`, `path`, `ai` (generateText), `@ai-sdk/anthropic`, `./types`, `../../runtime/core/patch` (applyPatches), `../../runtime/core/spec` (PatchOp)

**Key Internal Functions:**
- `resolveAllSpecs()` — Replays all scene mutations to get resolved spec at each point
- `compactSpec()` — Extracts visual summary for prompt
- `formatSpecTimeline()` — Formats spec evolution (summarizes early states, details last 5)
- `computeTimingBreakdown()` — Session timing, tool allocation, thinking gaps, mutation intervals
- `analyzeWorkflow()` — Feature usage detection, component diversity, element count progression
- `runEval()` — Calls Claude Opus 4.6 with text + image parts

**Side Effects:** Filesystem reads (screenshots), LLM calls, filesystem writes (evaluation.md)

---

### harness/lib/scenario.ts

**Purpose:** Load scenario configs from disk and manage dazzle stage lifecycle (create, seed data upload, destroy) via MCP.
**Lines of Code:** 160

**Exports:**
- `loadScenario(scenarioName): ScenarioConfig`
- `connectMCP(dazzleUrl, stageId, apiKey): Promise<Client>`
- `createStage(config, dazzleUrl, apiKey): Promise<{stageId}>`
- `destroyStage(stageId, dazzleUrl, apiKey): Promise<void>`

**Dependencies:** `fs`, `path`, `@modelcontextprotocol/sdk`, `./types`

---

### harness/lib/scene-observer.ts

**Purpose:** Polls `sceneRead` MCP tool every 500ms to detect scene mutations and record snapshots with mutation indices.
**Lines of Code:** 59

**Exports:**
- `SceneObserverClient` (interface) — `{ callTool(name, args) }`
- `SceneObserver` (class) — `start()`, `stop()`, `getSnapshots(): SceneSnapshot[]`

---

### harness/lib/hls-capture.ts

**Purpose:** Downloads HLS stream segments via polling and stitches them to MP4 using ffmpeg.
**Lines of Code:** 131

**Exports:**
- `HlsCapture` (class) — `start()`, `stop(): Promise<string | null>`

**Side Effects:** Filesystem writes (segments, MP4), network fetch, ffmpeg subprocess

---

### harness/lib/user-simulator.ts

**Purpose:** Simulates interactive users using Claude via OpenRouter. Builds prompts from persona + current scene + conversation history, parses "SAY: message" or "WAIT" responses.
**Lines of Code:** 184

**Exports:**
- `UserSimulator` (class) — `evaluate(): Promise<void>`, `recordAssistantAction(description)`

**Dependencies:** `ai` (generateText), `@ai-sdk/openai` (createOpenAI for OpenRouter)

**Side Effects:** LLM API calls (OpenRouter), env var reads (OPENROUTER_API_KEY)

---

### harness/lib/video-transcriber.ts

**Purpose:** Transcribe video using vision-capable LLM. Prefers Google Gemini (native video support), falls back to OpenRouter.
**Lines of Code:** 274

**Exports:**
- `TranscriptionResult` (interface) — `{ transcription, provider, model, outputPath }`
- `transcribeVideo(videoPath, outputDir): Promise<TranscriptionResult | null>`

**Side Effects:** Filesystem reads/writes, network fetch (Gemini API, OpenRouter)

---

### harness/lib/replay.ts

**Purpose:** Generates self-contained `replay.html` files with iframe-based preview, timeline scrubber, auto-play, keyboard shortcuts, and embedded scene data.
**Lines of Code:** 1,713

**Exports:**
- `generateReplay(result: SessionResult, outputDir: string): void`

**What Future Contributors Must Know:** This is the largest file in the harness. It builds a complete standalone HTML page with embedded JavaScript that replays scene snapshots. The iframe rendering duplicates component rendering logic from the runtime (Box, Stack, Grid, etc. as HTML/CSS) — changes to runtime components should be reflected here for accurate replay.

**Key Features:**
- Transport controls (play/pause, prev/next, speed 0.25x-4x)
- Draggable scrubber with snapshot marks
- JSON panel toggle (J key), fullscreen toggle
- Session metadata header
- Scene timeline sidebar
- Embedded `applyPatches()` and `resolveSpec()` functions
- Iframe-based preview with complete component rendering

---

### harness/lib/logger.ts

**Purpose:** ANSI-colored console logging for session execution with elapsed time, tool call context, and scene mutation tracking.
**Lines of Code:** 121

**Exports:**
- `Logger` (class) — `agentText()`, `toolCall()`, `sceneMutation()`, `summary()`

---

### harness/run.ts

**Purpose:** Main CLI entry point. Orchestrates scenario execution, HLS capture, scene observation, video transcription, evaluation, and batch operations.
**Lines of Code:** 750

**Key Functions:**
- `runScenario(name, dazzleUrl, apiKey)` — Full pipeline: load scenario → create stage → start capture + observer → run agent → extract keyframes → transcribe → evaluate → destroy stage
- `runTranscribeOnly()` — Batch transcribe existing sessions
- `runEvalOnly()` — Batch re-evaluate with replay screenshots
- CLI: `npx tsx run.ts <scenario> [--parallel]`, `--transcribe`, `--eval`

**Platform Prompt (injected into all scenarios):**
> This is BROADCAST MOTION GRAPHICS, not a slideshow. Use sceneSet for first scene and major transitions. Use scenePatch to build within a scene. Use stateSet for data updates. Wait 1-3s between visual changes. New visual element every 3-8s. No blank screens >15s.

---

## Scenarios (14 total)

| Scenario | Type | Purpose | Has Persona | Extra Tools |
|----------|------|---------|-------------|-------------|
| **hello-world** | Autonomous | 5 fun facts about dogs (baseline) | No | - |
| **ambient-art** | Autonomous | 4-movement generative art film | No | - |
| **choose-adventure** | Interactive | Startup founding narrative with 5 decision points | Yes (Alex) | - |
| **composable-stream** | Interactive | Multi-desk news broadcast (Situation/Onion/Editorial) | Yes (EP) | WebSearch, WebFetch |
| **cinematic-broadcast** | Autonomous | Documentary-style broadcast segment | No | - |
| **coding-game** | Autonomous | Live coding stream: Slither.io clone | No | - |
| **devops-pipeline** | Autonomous | SpaceX-style deployment monitoring | No | - |
| **generative-visuals** | Autonomous | Pure aesthetic generative art (no text) | No | - |
| **interactive-assistant** | Autonomous | AI assistant with 4 scripted tasks | No | - |
| **media-showcase** | Autonomous | Photography exhibition: Earth's Extremes | No | - |
| **mission-control** | Autonomous | Mars rover landing simulation | No | - |
| **onion-news** | Autonomous | Satirical news broadcast (ONN) | No | - |
| **personal-agent** | Autonomous | Premium AI assistant with 7 tasks | No | - |
| **situation-monitor** | Autonomous | Intelligence operation monitoring | No | WebSearch, WebFetch |

---

## Contributor Checklist

**Risks & Gotchas:**
- `runtime/core/patch.ts` has an auto-correction guard for array-append that may mask bugs — if you see unexpected array behavior, check whether `applyOne` is auto-correcting
- `harness/lib/replay.ts` duplicates component rendering logic from runtime — changes to runtime components must be manually synced
- `runtime/generate-catalog.ts` and `runtime/watch.mjs` import from `../stream/src/catalogs/` which is an external/merging repo
- The renderer uses classic JSX mode (`React.createElement`) — do not switch to automatic runtime without updating prelude
- Timeline `TransitionSpec` supports crossfade/CSS types but only "cut" is implemented
- The `window.__sceneSpec()` and `window.__timelineState()` globals are called via CDP eval — renaming breaks control-plane

**Pre-change Verification Steps:**
1. `cd runtime && npm run build` — verify both bundles compile
2. Check `dist/prelude.js` (~192kb) and `dist/renderer.js` (~35kb) sizes haven't exploded
3. If changing core types, grep for imports in `harness/lib/evaluator.ts` and `harness/lib/replay.ts`
4. If adding/renaming a component, update `runtime/components/index.ts`, `renderer.tsx` COMPONENTS map, and `harness/lib/replay.ts` iframe rendering

**Suggested Tests Before PR:**
- Run `cd runtime && npm run build` (build succeeds)
- Run a hello-world scenario: `cd harness && npx tsx run.ts hello-world`
- Verify replay.html renders correctly in browser
- Check `make build-runtime` succeeds in Kind cluster context

---

## Architecture & Design Patterns

### Code Organization

**Runtime** follows a layered architecture:
1. **Core types** (`core/`) — Pure TypeScript types and functions, no React dependency (except registry.ts)
2. **Components** (`components/`) — 37 React components, each in its own file, barrel-exported via `index.ts`
3. **Entry points** — `prelude.ts` (globals) and `renderer.tsx` (app + event handlers)
4. **Build tooling** — `watch.mjs` and `generate-catalog.ts`

**Harness** follows a pipeline architecture:
1. **Types** (`lib/types.ts`) — Shared domain types
2. **Infrastructure** (`lib/scenario.ts`, `lib/hls-capture.ts`, `lib/scene-observer.ts`) — Stage management and capture
3. **Agent** (`lib/agent.ts`, `lib/user-simulator.ts`) — AI orchestration
4. **Analysis** (`lib/evaluator.ts`, `lib/video-transcriber.ts`, `lib/replay.ts`) — Post-session processing
5. **Orchestrator** (`run.ts`) — CLI that wires everything together

### Design Patterns

- **Spec-driven rendering**: Declarative scene graph (JSON) → component tree. No imperative DOM manipulation.
- **Flat element map**: Elements are `Record<string, UIElement>`, not nested. Children referenced by key. Enables O(1) patches.
- **Immutable updates**: `applyPatches` always deep-clones via `structuredClone`. Zustand re-renders on new object reference.
- **State expressions**: `{ "$state": "/path" }` enables reactive data binding without coupling components to state shape.
- **IIFE bundles**: Both prelude and renderer are bundled as IIFE for `<script>` tag loading. No module system at runtime.
- **Custom event bus**: Streamer dispatches `CustomEvent("event")` with `{ event, data }` detail. Decouples Vite HMR from React.
- **Write-and-forget capture**: HLS capture, scene observer, and stream events all write independently. Session is assembled post-hoc.
- **Multimodal evaluation**: Evaluator uses both text analysis (spec timeline, tool calls, timing) and visual analysis (screenshots, video transcription).

### State Management Strategy

**Runtime:** Zustand store holds the current `Spec`. Timeline state is a plain object (not in Zustand) managed by `setTimeout` scheduling. State updates flow: event → `useSceneStore.getState().setSpec()` → React re-render.

**Harness:** No shared state management. Each module is functional/class-based. Session state accumulates in `runScenario()` closure and is serialized to disk.

### Error Handling Philosophy

**Runtime:** Minimal — unknown components fall back to `Fallback` (renders a div). Expression resolution returns `undefined` for missing paths. Patch resolution throws on invalid paths (crash-loud for debugging).

**Harness:** Defensive — try/catch around video transcription and evaluation (non-fatal). Stage cleanup in finally blocks. HLS capture warns on gaps but continues.

### Testing Strategy

**No test files exist** for either runtime or harness. Testing is done via the harness scenario system itself — running scenarios and evaluating output quality acts as integration testing.

---

## Data Flow

### Runtime Data Flow

```
Streamer (Vite HMR)
  → CustomEvent("event", { event: "scene:snapshot|patch|stateSet", data })
    → renderer.tsx event listener
      → applyPatches() or direct setSpec()
        → Zustand store update
          → React re-render
            → RenderElement (recursive)
              → resolveExpressions(props, state)
                → Component render
```

**Timeline Data Flow:**
```
CustomEvent("timeline:append", { entries })
  → timelineState.entries (sorted by at)
    → scheduleNext() → setTimeout
      → fireEntry() → store.setSpec()
        → React re-render
```

### Data Entry Points

- **scene:snapshot** — Full spec replacement (initial scene or major transitions)
- **scene:patch** — Incremental PatchOp[] array
- **scene:stateSet** — Single state path update
- **timeline:append** — Add timeline keyframes
- **timeline:play** — Play/pause/stop/seek commands
- **timeline:clear** — Reset timeline

### Data Transformations

- **applyPatches** — RFC 6902 JSON Patch on deep-cloned Spec
- **resolveExpressions** — `$state` pointer resolution in element props
- **fireEntry** — Timeline action → spec mutation (snapshot/patch/stateSet)
- **firePastEntries** — Fast-forward through entries up to current elapsed time

### Data Exit Points

- **React DOM** — Rendered HTML in Chrome browser
- **window.__sceneSpec()** — Current spec (read via CDP eval by control-plane)
- **window.__timelineState()** — Current timeline state (read via CDP eval)

---

### Harness Data Flow

```
Scenario (prompt.md + config.json + seed/)
  → loadScenario() → ScenarioConfig
    → createStage() → stageId (MCP)
      → runAgent() or runInteractiveAgent()
        ├─ Agent streams → ToolCall[] + text (callbacks → Logger + StreamCollector)
        ├─ SceneObserver polls sceneRead → SceneSnapshot[]
        └─ HlsCapture polls HLS → segments → MP4
      → SessionResult assembled
        → saveSession() → stream.jsonl, scenes.jsonl, meta.json, replay.html
        → extractKeyframes() → screenshots via ffmpeg
        → transcribeVideo() → transcription.md via Gemini/OpenRouter
        → evaluate() → evaluation.md via Claude Opus 4.6
      → destroyStage()
```

---

## Integration Points

### APIs Consumed (by Harness)

- **Dazzle MCP** (via StreamableHTTPClientTransport): `start`, `stop`, `set_script`, `edit_script`, `get_script`, `screenshot`, `sceneSet`, `scenePatch`, `stateSet`, `sceneRead`, `timelineAppend`, `timelinePlay`, `catalogRead`
  - Auth: Bearer token (API key)
- **Anthropic API** (via @ai-sdk/anthropic): Agent execution (streamText/generateText), evaluation (generateText with Claude Opus 4.6)
  - Auth: ANTHROPIC_API_KEY env var
- **OpenRouter API** (via @ai-sdk/openai): User simulator (Claude Sonnet 4.6), video transcription fallback
  - Auth: OPENROUTER_API_KEY env var
- **Google Gemini API** (direct fetch): Video transcription (preferred provider)
  - Auth: GEMINI_API_KEY env var

### APIs Exposed (by Runtime)

- **window.__sceneSpec()** — Returns current Spec (called via CDP eval by control-plane)
- **window.__timelineState()** — Returns timeline state with elapsed time and cursor

### Shared State

- **runtime/core/ types** — Shared between runtime and harness via direct import (`../../runtime/core/patch`, `../../runtime/core/spec`)
- **Catalog files** — Generated by runtime (`dist/catalog-index.md`, `dist/catalog-full.md`), served by control-plane to agents
- **Runtime bundles** — Built by runtime (`dist/prelude.js`, `dist/renderer.js`), loaded by streamer pods

### Events

- **CustomEvent("event")** — Runtime listens for 6 event types dispatched by streamer's Vite HMR system
  - Published by: Streamer (index.js) via Vite HMR emit_event
  - Consumed by: Runtime (renderer.tsx)

---

## Dependency Graph

### Entry Points (Not Imported by Others in Scope)

- `runtime/renderer.tsx` — Main browser entry (IIFE bundle)
- `runtime/prelude.ts` — Browser globals entry (IIFE bundle)
- `runtime/generate-catalog.ts` — Node.js build script
- `runtime/watch.mjs` — Node.js dev watcher
- `harness/run.ts` — CLI entry point

### Leaf Nodes (Don't Import Others in Scope)

- `runtime/core/expressions.ts` — No internal imports
- `runtime/core/timeline.ts` — Only imports from spec.ts (types only)
- All 37 runtime components — Import nothing from runtime (use JSX globals)
- `harness/lib/types.ts` — Pure type definitions
- `harness/lib/logger.ts` — Only imports types
- `harness/lib/scene-observer.ts` — Only imports types

### Circular Dependencies

No circular dependencies detected.

---

## Testing Analysis

### Test Coverage Summary

No test files exist for runtime or harness. Coverage: 0%.

### Testing Gaps

- No unit tests for `applyPatches` (critical function with auto-correction logic)
- No unit tests for `resolveExpressions`
- No component render tests
- No timeline state machine tests
- Harness relies entirely on end-to-end scenario execution for validation

---

## Related Code & Reuse Opportunities

### Similar Features Elsewhere

- **stream/ (external repo being merged)** — Contains the actual catalog definitions (`generalCatalog`) that runtime's `generate-catalog.ts` imports. The catalog Zod schemas define the component prop contracts.
- **streamer/index.js** — Implements the Vite HMR panel system and `emit_event` dispatch that triggers runtime's event listeners
- **control-plane/mcp.go** — Defines MCP tools (sceneSet, scenePatch, stateSet, etc.) that produce the events runtime consumes

### Patterns to Follow

- **New component**: Create `runtime/components/NewComp.tsx`, add to `components/index.ts`, add to `renderer.tsx` COMPONENTS map, add Zod schema to catalog in stream/, update `harness/lib/replay.ts` iframe rendering
- **New timeline action type**: Add to `TimelineEntry.action` union in `core/timeline.ts`, handle in `fireEntry()` in `renderer.tsx`, handle in `harness/lib/evaluator.ts` resolveAllSpecs

---

## Implementation Notes

### Code Quality Observations

- Consistent component pattern — all 37 components follow the same `{ props, children? }` signature
- Clean separation between core types (no React) and components (React)
- Harness evaluator is comprehensive (timing analysis, workflow analysis, multimodal eval)
- replay.ts is the largest file and would benefit from extraction of the iframe rendering logic

### TODOs and Future Work

- `runtime/core/expressions.ts:6` — "Future: $cond, $template, $computed" expressions
- `runtime/core/timeline.ts` — TransitionSpec "crossfade" and "css" types not yet implemented
- `runtime/core/registry.ts` — `defineRegistry()` exists but renderer uses direct COMPONENTS map instead

### Known Issues

- `harness/lib/replay.ts` duplicates component rendering logic — drift risk with runtime changes
- `runtime/generate-catalog.ts` depends on `../stream/` repo which is being merged
- No tests exist for either subsystem

### Technical Debt

- `replay.ts` at 1,713 lines should be split (HTML template, component rendering, timeline logic)
- Component rendering in replay iframe should be extracted and shared with evaluator
- Registry pattern (`defineRegistry`) is defined but not used — renderer has its own COMPONENTS map

---

## Modification Guidance

### To Add a New Component

1. Create `runtime/components/NewComp.tsx` following the `{ props, children? }` pattern
2. Export from `runtime/components/index.ts`
3. Import and add to `COMPONENTS` map in `runtime/renderer.tsx`
4. Add Zod prop schema to catalog in `stream/src/catalogs/general/catalog.ts`
5. Add HTML/CSS rendering to `harness/lib/replay.ts` `buildIframeHtml()` function
6. Rebuild: `cd runtime && npm run build`

### To Add a New Timeline Action

1. Add new variant to `TimelineEntry.action` union in `runtime/core/timeline.ts`
2. Handle in `fireEntry()` in `runtime/renderer.tsx`
3. Handle in `resolveAllSpecs()` in `harness/lib/evaluator.ts`
4. Handle in replay.ts `resolveSpec()` if applicable

### To Add a New Harness Scenario

1. Create `harness/scenarios/<name>/` directory
2. Add `config.json` with `allowedTools[]` and optional settings
3. Add `prompt.md` with detailed scenario instructions
4. Optional: `persona.md` for interactive mode, `seed/` directory for data files
5. Run: `cd harness && npx tsx run.ts <name>`

### To Modify Existing Functionality

- **Changing a component's props**: Update the component TSX, the Zod schema in catalog, and replay.ts rendering
- **Changing the spec format**: Update `core/spec.ts`, then grep for all consumers (renderer, evaluator, replay, control-plane)
- **Changing wire protocol**: Update `WSMessage` in `core/spec.ts`, then update streamer's emit_event dispatch and renderer's event listener

### Testing Checklist for Changes

- [ ] `cd runtime && npm run build` succeeds
- [ ] `dist/prelude.js` and `dist/renderer.js` sizes are reasonable
- [ ] Run `hello-world` scenario end-to-end
- [ ] Open replay.html in browser and verify rendering
- [ ] If component changed, verify in both live renderer and replay iframe
- [ ] `make build-runtime` and `make deploy-runtime-scripts` succeed
- [ ] If core types changed, verify harness evaluator still resolves specs correctly

---

_Generated by `document-project` workflow (deep-dive mode)_
_Base Documentation: docs/index.md_
_Scan Date: 2026-03-05_
_Analysis Mode: Exhaustive_
