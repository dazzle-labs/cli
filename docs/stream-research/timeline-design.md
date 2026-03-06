# Elapsed Timeline System Design

## Problem

Agents take 5+ minutes of wall-clock time to produce content via MCP tool calls, but viewers should see a smooth, compressed presentation (default 30 seconds, configurable). Today, scene mutations arrive at wall-clock cadence and are applied immediately. There is no concept of "presentation time" -- the viewer sees each mutation the instant the agent produces it, resulting in long dead stretches punctuated by jarring jumps.

The elapsed timeline system introduces a virtual presentation clock. The agent schedules scene changes against this clock, and the client plays them back at 1x speed (or a configurable rate), producing a smooth, watchable presentation regardless of how long the agent took to author it.

## Architecture Overview

```
Agent (MCP)           Server                    Client (React)
    |                    |                           |
    |-- timelineAppend ->|                           |
    |   (t=0ms, spec)   |-- WS: timeline-entry ---->|
    |                    |                           |  (queued, not rendered yet)
    |-- timelineAppend ->|                           |
    |   (t=5000, patch)  |-- WS: timeline-entry ---->|
    |                    |                           |
    |-- timelinePlay --->|                           |
    |   (rate=1.0)       |-- WS: timeline-play ----->|
    |                    |                           |  (starts elapsed clock,
    |                    |                           |   renders t=0 immediately,
    |                    |                           |   renders t=5000 at +5s)
```

## Data Model

### TimelineEntry

A single keyframe on the elapsed timeline.

```typescript
interface TimelineEntry {
  /** Elapsed presentation time in milliseconds. */
  at: number

  /** What to do at this time. Exactly one of these is set. */
  action:
    | { type: "snapshot"; spec: Spec }        // full scene replacement
    | { type: "patch"; patches: PatchOp[] }   // incremental JSON Patch
    | { type: "stateSet"; path: string; value: unknown }  // state shorthand

  /** Transition applied when this entry becomes active. */
  transition?: TransitionSpec

  /** Optional human-readable label for debugging/harness. */
  label?: string
}
```

### TransitionSpec

Controls how the scene visually transitions when an entry fires.

```typescript
interface TransitionSpec {
  /** Duration of the transition in milliseconds. Default: 0 (instant cut). */
  duration?: number

  /** CSS easing function. Default: "ease-in-out". */
  easing?: string

  /**
   * Transition type:
   * - "cut"       — instant swap (default when duration is 0)
   * - "crossfade" — opacity crossfade between old and new scene
   * - "css"       — applies CSS transition properties to changed elements,
   *                 letting the browser interpolate layout/color/opacity
   */
  type?: "cut" | "crossfade" | "css"
}
```

### Timeline (server-side aggregate)

```typescript
interface Timeline {
  /** Ordered list of entries, sorted by `at` ascending. */
  entries: TimelineEntry[]

  /** Total presentation duration in milliseconds. Defaults to the `at` of the last entry + 1000. */
  duration?: number

  /** Playback state. */
  playback: {
    state: "stopped" | "playing" | "paused"
    rate: number          // 1.0 = realtime
    startedAt?: number    // wall-clock ms when playback began
    offsetMs?: number     // elapsed offset when paused (for resume)
  }
}
```

## MCP Tools

### New Tools

#### `timelineAppend`

Add one or more entries to the timeline. Entries are inserted in sorted order by `at`.

```
Tool: timelineAppend
Input: {
  entries: TimelineEntry[]    // one or more entries
}
Output: "Appended N entry/entries. Timeline has M total entries."
```

This is the primary authoring tool. Typical agent usage:

```jsonc
// Set up the opening scene at t=0
{ "entries": [
  { "at": 0,     "action": { "type": "snapshot", "spec": { ... } }, "label": "intro" },
  { "at": 5000,  "action": { "type": "patch", "patches": [...] }, "transition": { "type": "crossfade", "duration": 800 } },
  { "at": 12000, "action": { "type": "stateSet", "path": "/title", "value": "Results" } }
]}
```

The agent can call `timelineAppend` multiple times. Later calls can fill in earlier times -- entries are always kept sorted. If two entries share the same `at`, they are applied in insertion order.

#### `timelinePlay`

Start, pause, or stop playback.

```
Tool: timelinePlay
Input: {
  action: "play" | "pause" | "stop"
  rate?: number        // playback speed multiplier, default 1.0
  seekTo?: number      // jump to this elapsed ms before playing
}
Output: "Playback started at rate 1.0x." / "Paused at 5200ms." / "Stopped."
```

#### `timelineRead`

Read the current timeline state (entries, playback status, elapsed position).

```
Tool: timelineRead
Input: {}
Output: JSON of the full Timeline object plus computed currentElapsedMs.
```

#### `timelineClear`

Remove all entries and reset playback.

```
Tool: timelineClear
Input: {}
Output: "Timeline cleared."
```

### Existing Tools (unchanged)

The existing `sceneSet`, `scenePatch`, and `stateSet` tools continue to work exactly as they do today -- they mutate the scene immediately with no timeline involvement. This preserves backward compatibility. An agent that never calls `timelineAppend` sees zero behavioral change.

When a timeline is active and playing, immediate mutations via the existing tools are applied on top of the current timeline-resolved scene. This lets the agent do "live corrections" during playback if needed, though the typical flow is to author the timeline first and then play it.

## WebSocket Protocol Changes

### New Message Types

```typescript
// Existing (unchanged):
//   { type: "snapshot", spec: Spec }
//   { type: "patch", patches: PatchOp[] }

// New:
type WSMessage =
  | { type: "snapshot"; spec: Spec }
  | { type: "patch"; patches: PatchOp[] }
  | { type: "timeline-entry"; entry: TimelineEntry }
  | { type: "timeline-play"; playback: Timeline["playback"] }
  | { type: "timeline-clear" }
  | { type: "timeline-snapshot"; timeline: Timeline }  // full sync on connect
```

### Connection Behavior

When a client connects via WebSocket:

1. Server sends `{ type: "snapshot", spec }` with the current resolved scene (unchanged).
2. If a timeline exists, server immediately sends `{ type: "timeline-snapshot", timeline }` with all entries and current playback state.
3. The client can then reconstruct the correct visual state: if playback is in progress, it computes the current elapsed position from `playback.startedAt` and the current wall clock, and fast-forwards to the right keyframe.

### Incremental Updates

- When the agent calls `timelineAppend`, the server broadcasts `{ type: "timeline-entry", entry }` for each new entry.
- When the agent calls `timelinePlay`, the server broadcasts `{ type: "timeline-play", playback }`.
- When the agent calls `timelineClear`, the server broadcasts `{ type: "timeline-clear" }`.

## Server-Side Implementation

### TimelineState (new class, extends SceneState patterns)

```
src/server/timeline.ts
```

The `TimelineState` class manages the timeline alongside the existing `SceneState`. It is **not** a subclass -- it is a sibling that holds timeline-specific data and delegates scene mutations to `SceneState` when entries fire.

Key responsibilities:

1. **Entry storage**: Maintains a sorted array of `TimelineEntry` objects.
2. **Playback clock**: When playing, computes `currentElapsedMs = (Date.now() - startedAt) * rate + offsetMs`.
3. **Entry firing**: A `setInterval` (or `setTimeout` chain) checks the clock and fires entries whose `at` has been reached. Firing an entry means calling `state.set()`, `state.patch()`, or `state.stateSet()` on the underlying `SceneState`, which triggers the existing WebSocket broadcast of `snapshot`/`patch` messages.
4. **Listener notifications**: Broadcasts timeline-specific WS messages (`timeline-entry`, `timeline-play`, etc.) to connected clients via a parallel listener mechanism.

The server tick interval should be ~16ms (60fps) to ensure smooth playback. Entries that fall between ticks are applied at the next tick -- sub-frame precision is not needed for visual presentation.

### Integration with SceneState

```
SceneState (existing)           TimelineState (new)
    |                                |
    | .set() / .patch()              | .append() / .play() / .clear()
    |     ^                          |
    |     |                          |
    |     +---- fires entries via ---+
    |
    | broadcasts snapshot/patch to WS clients (unchanged)
```

The `TimelineState` does not replace `SceneState`. It wraps it: when an entry fires, `TimelineState` calls the appropriate mutation method on `SceneState`. This means the existing WebSocket broadcast, `specReducer` on the client, and all rendering code continue to work without modification.

### Tool Registration

In `src/server/tools.ts`, four new tools are registered: `timelineAppend`, `timelinePlay`, `timelineRead`, `timelineClear`. They call methods on a `TimelineState` instance created in `src/server/index.ts`.

## Client-Side Implementation

### Two Playback Modes

#### Mode 1: Server-driven (default, simpler)

The server fires entries on its own clock and sends the resulting `snapshot`/`patch` messages to the client. The client applies them exactly as it does today. The client receives `timeline-play` messages but only uses them for UI purposes (showing a progress bar, elapsed time display).

This is the recommended mode because:
- Zero changes to the existing render pipeline.
- No client-side timer drift issues.
- The server is the single source of truth for "what time is it."

#### Mode 2: Client-driven (for replay.html and offline playback)

The client receives the full timeline upfront (via `timeline-snapshot` or embedded in replay.html) and runs its own playback clock. At each animation frame, it computes `currentElapsedMs`, walks the sorted entries, and applies all entries with `at <= currentElapsedMs` that haven't been applied yet.

This mode is used exclusively in:
- `replay.html` (self-contained, no server)
- Future "share a recording" flows

### Transitions (client-side concern)

Transitions are purely a client rendering concern. When the client applies a scene mutation that has a `TransitionSpec`:

**Cut (default)**: The scene changes instantly. This is what happens today.

**Crossfade**: The renderer captures the current visual output into an overlay `<div>` (via CSS `opacity`), applies the new scene underneath, and fades the overlay from 1 to 0 over the transition duration. Implementation sketch:

```tsx
// In Renderer.tsx or a new TransitionLayer wrapper
const [prevSpec, setPrevSpec] = useState<Spec | null>(null)
const [opacity, setOpacity] = useState(1)

// When a transition entry fires:
setPrevSpec(currentSpec)   // freeze current as overlay
setOpacity(1)
applyNewSpec()             // apply new scene underneath
// Animate opacity from 1 -> 0 over transition.duration ms
```

**CSS**: The renderer applies `transition: all ${duration}ms ${easing}` to the viewport container. When props/styles change, the browser interpolates automatically. This works well for color, opacity, transform, and layout changes. It does not work for structural changes (adding/removing elements).

### Timeline UI (optional, not required for v1)

A small progress bar at the bottom of the viewport showing elapsed position and total duration. This is purely decorative and can be toggled off. It receives `timeline-play` messages to know the playback state and computes the position client-side via `requestAnimationFrame`.

## Harness Integration

### Recording

The `Recorder` class (`harness/lib/recorder.ts`) already captures every WebSocket message with a wall-clock timestamp. No changes needed -- it will naturally capture the `timeline-entry`, `timeline-play`, and scene mutation messages that result from timeline playback.

Additionally, the harness should save the raw timeline data alongside existing session artifacts:

```
sessions/<id>/
  stream.jsonl          (tool calls, unchanged)
  scenes.jsonl          (scene snapshots, unchanged)
  timeline.json         (new: the full Timeline object at session end)
  meta.json             (updated: add timeline stats)
  replay.html           (updated: timeline-aware playback)
```

The `timeline.json` file is the authoritative record of what the agent intended. The `scenes.jsonl` file records what actually happened (the mutations that fired during playback).

### Replay Generation

The `generateReplay` function (`harness/lib/replay.ts`) is updated to produce a timeline-aware replay.html:

1. **If `timeline.json` exists**: The replay embeds the full timeline and uses client-driven playback (Mode 2). The viewer sees the presentation as the agent intended it, with transitions and timing.

2. **If no timeline**: Backward compatible. The replay works exactly as it does today -- stepping through scene snapshots with prev/next buttons.

The timeline-aware replay adds:
- A play/pause button and a scrub bar.
- A playback rate selector (0.5x, 1x, 2x).
- The existing step-through sidebar remains for debugging.

### Evaluation

The evaluator receives both `timeline.json` and `scenes.jsonl`. It can assess:
- Did the agent use the timeline feature at all?
- Is the pacing reasonable (not all entries crammed at t=0)?
- Does the total duration match the scenario's target?
- Are transitions used effectively?

## How the Agent Expresses Timing

The agent uses **absolute elapsed milliseconds** as the primary timing mechanism. This is the simplest model:

- Unambiguous: `at: 5000` always means "5 seconds into the presentation."
- Order-independent: The agent can add entries in any order; the server sorts by `at`.
- Composable: Multiple `timelineAppend` calls can fill in different time ranges without conflict.

Relative offsets and named cues were considered and rejected for v1:

- **Relative offsets** ("500ms after the previous entry") require the agent to track what it already scheduled, adding cognitive load for the LLM and creating ordering dependencies between tool calls.
- **Named cues** ("after intro-complete") add indirection without clear benefit; the agent already knows what time it wants.

If future use cases demand them, relative offsets can be supported by having the server resolve them to absolute `at` values at insertion time, keeping the core data model unchanged.

## Interaction with Existing Scene State

The timeline does not replace the scene state system. It layers on top:

```
        +-------------------+
        |    Timeline       |  "at t=5000, apply this patch"
        +-------------------+
                 |
                 v  (fires entries at the right time)
        +-------------------+
        |   SceneState      |  single current Spec
        +-------------------+
                 |
                 v  (broadcasts to clients)
        +-------------------+
        |   WebSocket       |
        +-------------------+
                 |
                 v
        +-------------------+
        |   React Renderer  |  renders current Spec
        +-------------------+
```

- `sceneSet`/`scenePatch`/`stateSet` continue to mutate the scene immediately.
- `timelineAppend` schedules future mutations.
- When a timeline entry fires, it calls `sceneSet`/`patch`/`stateSet` under the hood.
- The renderer never knows or cares whether a mutation came from a direct tool call or from a timeline entry firing. It just renders the current spec.

## Edge Cases

**Late entries**: The agent appends an entry with `at: 3000` while playback is already at `t=7000`. The server applies it immediately (it's in the past). This supports the live authoring case where the agent is still building the timeline while playback has started.

**Duplicate times**: Multiple entries at the same `at` value are applied in insertion order. This is fine -- it's equivalent to calling `scenePatch` twice in rapid succession.

**Empty timeline**: Calling `timelinePlay` on an empty timeline is a no-op that returns an error message.

**Playback beyond last entry**: After the last entry fires, playback continues until `duration` is reached (or indefinitely if no duration is set). The scene remains in its final state. The agent can call `timelinePlay({ action: "stop" })` to explicitly end playback.

**Hot-reload during playback**: If the agent calls `sceneSet` (direct, not via timeline) during playback, the direct mutation is applied immediately. The next timeline entry that fires will overwrite it. This is intentional -- direct mutations are "overrides" that the timeline will supersede.

## Migration and Backward Compatibility

- All existing tools, wire protocol messages, and rendering behavior are unchanged.
- Agents that do not call `timelineAppend` see zero difference.
- The `timeline-snapshot` WebSocket message is only sent when a timeline exists.
- Existing `replay.html` files (without timeline data) continue to work.
- The new MCP tools are additive; they do not modify the signatures or behavior of existing tools.

## File Changes Summary

New files:
- `src/server/timeline.ts` — `TimelineState` class
- `src/core/timeline.ts` — shared types (`TimelineEntry`, `TransitionSpec`, `Timeline`)

Modified files:
- `src/server/index.ts` — instantiate `TimelineState`, pass to `registerTools`
- `src/server/tools.ts` — register 4 new timeline tools
- `src/server/web.ts` — send `timeline-snapshot` on connect, broadcast timeline messages
- `src/core/spec.ts` — add new `WSMessage` variants for timeline
- `src/app/App.tsx` — handle new WS message types (store timeline state for UI)
- `src/renderer/Renderer.tsx` — optional transition layer for crossfade/css transitions
- `harness/run.ts` — save `timeline.json` alongside session artifacts
- `harness/lib/replay.ts` — timeline-aware replay with play/pause/scrub
- `harness/lib/types.ts` — add timeline fields to `SessionResult` and `SessionMeta`
- `harness/lib/recorder.ts` — capture timeline messages (may already work via existing generic capture)
