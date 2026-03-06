# Stream Platform Specification

## 1. What It Is

Stream is a real-time visual rendering surface controlled by AI agents through MCP tools. Agents compose broadcast-quality motion graphics on a 1920x1080 canvas by manipulating a declarative scene spec -- a JSON tree of typed UI components. The platform captures video, evaluates output quality via LLM, and identifies catalog gaps to drive iterative improvement.

## 2. Architecture

Four layers, each independent:

| Layer | Role | Key Technology |
|-------|------|----------------|
| **MCP Server** | Exposes scene manipulation tools over stdio | `@modelcontextprotocol/sdk`, stdio transport |
| **Scene State** | Single source of truth; broadcasts changes via WebSocket | Pub/sub over `ws` on Express |
| **React Renderer** | Renders spec into a fixed-size iframe, CSS-scaled to viewport | React 19, Vite, iframe portal |
| **Evaluation Harness** | Runs agents against scenarios, records video, scores output | Vercel AI SDK, Puppeteer, ffmpeg |

**Data flow:** Agent calls MCP tool (stdio) -> server mutates SceneState -> WebSocket pushes snapshot/patch -> React renderer updates iframe.

The renderer uses an iframe at the logical canvas resolution (default 1920x1080) so CSS viewport units and pixel values are resolution-independent. The iframe is CSS-scaled with letterboxing to fit any browser window, like a presentation slide. Components can use `@container` queries on the canvas container.

## 3. Scene Spec (Core Protocol)

A scene is a flat map of named elements forming a tree via `children` references:

```json
{
  "root": "<element-key>",
  "elements": { "<key>": UIElement },
  "state": { "<arbitrary-json>" }
}
```

### UIElement

| Field | Type | Required | Purpose |
|-------|------|----------|---------|
| `type` | string | yes | Component name from catalog |
| `props` | object | yes | Component-specific properties; all accept optional `style` (CSS overrides) |
| `children` | string[] | no | Keys of child elements (container components only) |
| `slot` | string | no | Named slot hint (e.g. `"main"`, `"lower_third"`) |

**Why a flat map instead of nested trees:** Flat structures are dramatically easier for language models to generate and patch correctly. JSON Patch paths like `/elements/my-title/props/text` are unambiguous regardless of tree depth.

### State Bindings

Any prop value can be `{ "$state": "/json/pointer/path" }`. The renderer resolves these against `spec.state` at render time. Agents update state values individually via `stateSet`, separating data from structure.

### Mutation Primitives

| Primitive | Tool | Use |
|-----------|------|-----|
| **Snapshot** | `sceneSet` | Replace entire spec. Major scene transitions. |
| **Patch** | `scenePatch` | RFC 6902 JSON Patch operations. Incremental changes within a scene. |
| **State update** | `stateSet` | Update a single value in `spec.state` by JSON Pointer. |

This snapshot+patch model is the primary creative tool for broadcast pacing: `sceneSet` = hard cut, `scenePatch` = layering information over time.

## 4. Component Library

31 components across 8 categories. All accept an optional `style` prop for CSS overrides.

### Layout

| Component | Description | Key Props |
|-----------|-------------|-----------|
| **Box** | General-purpose container | _(children only)_ |
| **Stack** | Vertical/horizontal stack with gap | `direction`, `gap`, `align`, `justify` |
| **Grid** | CSS Grid layout | `columns`, `rows`, `gap` |
| **Split** | Two-panel split (primary/secondary) | `ratio`, `direction`, `gap` |
| **Gradient** | Container with CSS gradient background | `type` (linear/radial/conic), `colors`, `angle`, `direction` |

### Text

| Component | Description | Key Props |
|-----------|-------------|-----------|
| **Heading** | Display heading (hero: 64-120px, section: 36-56px) | `text`, `level` (1-6) |
| **Text** | Body text with variant styling | `text`, `variant` (body/caption/label/mono) |
| **Code** | Code block with monospace font | `code`, `language`, `title` |

### Content

| Component | Description | Key Props |
|-----------|-------------|-----------|
| **Card** | Card with optional header; children in content area | `title`, `subtitle` |
| **Image** | Image from URL | `src`, `alt`, `fit` (cover/contain/fill/none) |
| **Divider** | Horizontal or vertical divider line | `direction` |

### Broadcast

| Component | Description | Key Props |
|-----------|-------------|-----------|
| **LowerThird** | Broadcast lower-third overlay (name + title) | `name`, `title`, `subtitle`, `accentColor` |
| **Ticker** | Scrolling horizontal text ticker | `items[]` (text, category, urgent), `speed` |
| **Banner** | Full-width announcement bar | `text`, `severity` (info/warning/error/success) |
| **Badge** | Status tag/pill | `text`, `variant` (default/success/warning/error/info) |

### Data

| Component | Description | Key Props |
|-----------|-------------|-----------|
| **Stat** | Large statistic display with label | `value`, `label`, `unit`, `trend` (up/down/flat) |
| **ProgressBar** | Horizontal progress bar | `value` (0-100), `label`, `color` |
| **Sparkline** | Tiny inline SVG chart | `values[]`, `color`, `height`, `fill` |
| **Chart** | Declarative chart (bar/line/area/pie/donut) | `mark`, `data[]`, `xField`, `yField`, `color`, `colors`, `title` |
| **Table** | Data table with column definitions | `columns[]` (key, label, align, width), `rows[]`, `striped`, `compact` |

### SVG

| Component | Description | Key Props |
|-----------|-------------|-----------|
| **Shape** | SVG primitive (rect/circle/ellipse/polygon) | `shape`, `width`, `height`, `fill`, `stroke` |
| **Line** | SVG line between two points | `x1`, `y1`, `x2`, `y2`, `stroke` |
| **Path** | SVG path from data string | `d`, `fill`, `stroke` |
| **SvgContainer** | SVG wrapper with viewBox; children inside | `viewBox`, `width`, `height` |

### Animation

| Component | Description | Key Props |
|-----------|-------------|-----------|
| **Animate** | Enter/exit/loop animations on children | `preset`, `duration`, `delay`, `easing`, `loop` |
| **Stagger** | Sequences animation across children with staggered delay | `preset`, `interval`, `duration` |
| **FadeIn** | Simple fade-in on mount | `duration`, `delay` |
| **Transition** | CSS transitions on prop changes | `property`, `duration`, `easing` |
| **Counter** | Animated number counter (hero element: 72-120px) | `value`, `prefix`, `suffix`, `duration` |
| **Presence** | Conditional show/hide with enter/exit transitions | `visible`, `enter`, `exit`, `duration` |

### Media

| Component | Description | Key Props |
|-----------|-------------|-----------|
| **Overlay** | Absolutely positioned overlay container | `position` (top-left/top-right/bottom-left/bottom-right/center/full) |

**Valid Animate/Stagger presets:** `fade-in`, `slide-in-left`, `slide-in-right`, `slide-in-up`, `slide-in-down`, `scale-up`, `scale-down`, `bounce-in`, `pulse`. Invalid presets silently fall back to `fade-in`.

## 5. MCP Tools

### Scene Tools

| Tool | Description |
|------|-------------|
| `sceneSet` | Replace the entire scene spec. For first scene and major transitions. |
| `scenePatch` | Apply RFC 6902 JSON Patch operations. For incremental layering. |
| `stateSet` | Update a single value in `spec.state` by JSON Pointer path. Supports `/-` for array append. |
| `sceneRead` | Return the current full scene spec. |
| `catalogRead` | Return component catalog with design guidance. Optional `component` param for single-component detail. |
| `validateSpec` | Validate spec against catalog schemas. Optional `autoFix` fills missing required props with defaults. |
| `screenshotTake` | Capture a screenshot of the current visualization. Returns the image. |

### Timeline Tools

| Tool | Description |
|------|-------------|
| `timelineAppend` | Add entries to elapsed-time timeline. Each entry fires a mutation at a specified ms offset. |
| `timelinePlay` | Start/pause/stop playback. Supports seek and variable playback rate. |
| `timelineRead` | Read timeline state: entries, playback status, elapsed position. |
| `timelineClear` | Remove all entries and reset playback. |

### Harness-Injected Tools (not MCP)

| Tool | Description |
|------|-------------|
| `wait` | Pause 0.5-10 seconds between visual changes. |
| `done` | Signal stream completion. Stops the agent loop. |

## 6. Timeline System

An ordered list of entries, each specifying a scene mutation and elapsed-time offset (`at` in ms). Three action types: `snapshot`, `patch`, `stateSet`. Optional `transition` per entry: `cut` (instant), `crossfade`, or `css`, with configurable duration and easing.

The timeline is layered on SceneState: when entries fire during playback, they delegate to the same state object that direct tool calls use, so WebSocket broadcast happens identically. Playback runs a ~60fps tick loop that fires entries as wall-clock time passes their `at` offset. Auto-stops after the last entry plus 1 second.

## 7. Evaluation Harness

**Purpose:** Automated test loop: run agent against scenario -> record video -> extract keyframes -> evaluate quality -> identify catalog gaps.

### Pipeline

1. **Scenario** provides `prompt.md` (creative brief, never mentions tool names), optional `persona.md` (enables interactive mode with simulated user), `config.json` (model, effort level, tool permissions).
2. **Agent** runs via Vercel AI SDK (`streamText`/`generateText`) with MCP tools connected to a fresh stream server on an isolated `/tmp` workspace. Discovers components via `catalogRead`, then composes scenes.
3. **Recording** captures MP4 via Puppeteer (headless Chrome), plus scene snapshots, tool call timeline, and full agent activity stream as JSONL.
4. **Keyframe extraction** uses ffmpeg codec-native scene detection at progressive thresholds (0.1, 0.05, 0.03). Falls back to fixed positions (first/middle/last) if detection fails. Capped at 8 frames.
5. **Evaluation** is a single LLM call (Claude Opus) receiving: scenario prompt, timing metrics, workflow analysis, spec timeline, screenshots as images, video transcription, and console errors. Scores timing/efficiency, agent strategy, visual design, runtime errors, and scenario compliance.

### Key Design Decisions

- **Screenshots are ground truth.** Specs show intent; screenshots show what the viewer actually saw.
- **Agent isolation.** Agents run in `/tmp` workspaces with no source repo access. Only MCP stream tools available.
- **Self-observation loop.** `sceneRead` + `screenshotTake` let the agent see and iterate on its own output.
- **Video transcription** (LLM-described frames) provides evidence when screenshots are unavailable.
- **Interactive mode.** A simulated user (LLM persona) sends messages to the agent mid-session, testing conversational responsiveness.
- **Transcription gates evaluation.** If video transcription fails, evaluation is skipped rather than running with degraded input.

### Session Artifacts

`stream.jsonl`, `scenes.jsonl`, `meta.json`, `replay.html`, `evaluation.md`, video MP4, keyframe screenshots, `video-transcription.md`, `console-errors.log`.

## 8. Design Principles

Embedded in the catalog system prompt. Enforced through evaluation scoring.

**Broadcast, not web UI.** Motion graphics for a 1920x1080 canvas on large screens. Reference: Apple Keynote, CNN/ESPN, Bloomberg. No card borders, box shadows, rounded containers. Content floats on rich backgrounds.

**Fill the frame.** Full-bleed backgrounds. 80%+ frame width. Padding (48-80px) instead of maxWidth. No narrow centered columns.

**Scale for broadcast.** Hero headings: 64-120px. Subheadings: 36-56px. Body: 24-36px. Nothing below 16px. Visible from 10 feet.

**Color discipline.** One primary color family per scene, at most 2 accent colors. Deep saturated backgrounds (not web-UI greys). White/near-white text. Fewer colors is better.

**Motion is mandatory.** Animate/Stagger for entrance animations. Static scenes feel cheap. 400-1000ms durations.

**Incremental delivery.** Build scenes beat-by-beat with `scenePatch`. Background + hero first, then layer supporting elements. New visual element every 3-5 seconds. `sceneSet` only for major transitions.

**Pacing.** Each tool call = one beat of narration. Blank screen >15 seconds is failure. Static scene >10 seconds means content should be patching in. Wait times: 1-3 seconds between changes.

## 9. Non-Goals

- **Interactive input widgets.** Stream is broadcast. Viewers watch; they do not click buttons.
- **Pixel-perfect design tools.** Agents use semantic components and layout systems, not absolute pixel positioning.
- **General-purpose web framework.** No routing, auth, databases, or app state beyond displayed content.
- **Multi-agent scene editing.** One agent owns one stream. Composition happens at stream level.
- **Code generation.** Agents compose from pre-built components through structured tool calls. They never write HTML/CSS/JS.
