# Relocation History Context — Stream Repository

> Compiled from 2 days of Claude Code conversation history in `/Users/cruhl/GitHub/stream`.
> This document captures the user's (Conner's) raw requirements, design decisions, and strategic direction for relocating this codebase into John's "agent-streamer" repo.

---

## Table of Contents

1. [The Relocation Statement](#1-the-relocation-statement)
2. [Strategic Vision & Core Thesis](#2-strategic-vision--core-thesis)
3. [Protocol Design](#3-protocol-design)
4. [Rendering Architecture](#4-rendering-architecture)
5. [Harness & Evaluation System](#5-harness--evaluation-system)
6. [Agent Behavior & Scenarios](#6-agent-behavior--scenarios)
7. [Templates & Catalog Architecture](#7-templates--catalog-architecture)
8. [MCP/ACP Tool Surface](#8-mcpacp-tool-surface)
9. [Multi-Agent Coordination Patterns](#9-multi-agent-coordination-patterns)
10. [Evolution of Thinking & Contradictions](#10-evolution-of-thinking--contradictions)
11. [Technical Specifications](#11-technical-specifications)

---

## 1. The Relocation Statement

The user's own words on what the relocation means (verbatim, most recent message):

> "Okay, so we're about to do a massive lift and ship of the repository I've been working on here in stream into John's agent streamer repo. Agent streamer repo is set up with all of the rendering architecture and a bunch of pre done work on key management. The front door has stubs for landing page, etc. So what we need to do is sort of unify this work."

> "In general, the goal of this repo has been to set up a harness by which I can create enough scenarios with enough complexity to start driving the ultimate protocol that agents use to communicate their intent and operate a video live stream."

> "We have two kind of core requirements that I'm trying to enable with this repo. One is I want the ability to sort of evaluate using the harness all aspects of the platform in the end so that I can have scenarios like play this news broadcast and then have other LLMs and AI processes evaluate the actual outputs against what was intended to really harsh criticism and judgment on visuals, timings, everything. That way we could sort of automatically iterate on the protocol and the implementation at the same time against a set of scenarios that we can score."

> "This repo is in a state of flight. The protocol is definitely not well specified enough. It currently uses a sort of iterative approach but what we really want is a declarative protocol that allows agents in an extremely token efficient way to describe complicated audio visuals using, you know, there's a lot of precedent for this like in remotion and JSON render that we're taking inspiration from but ultimately what we're looking for is something that allows agents to describe faster than real time these audio visuals that can then get interpreted by both a visualizer and can be interpreted and composed by other agents so into other streams."

> "I want this continued ability to have these extremely rich evaluations of scenarios we can use to push the protocol forward and I don't really care how the protocol is implemented in the new repository but I do want the ability to maintain this level of end to end iteration and perform these tests."

---

## 2. Strategic Vision & Core Thesis

### The Pivot

The company (Dazzle, dazzle.fm) pivoted from GPU-rendered video streaming to **agentic broadcasting** — AI agents driving live streams rendered in Chrome sandboxes.

**User's own framing:**

> "We're transitioning dazzle.fm into a platform for agent streams and on the implementation side we're figuring out the right contract between agents and the rendering layer, getting the renderer able to push to Twitch and YouTube, and running our own agent streams to test everything end-to-end."

### Economics

- GPU rendering: $3.50-5/hr
- Chrome sandbox rendering: ~$0.10/hr (35x cheaper)
- Cash position: $145,712.09 (as of March 2nd, 2026 investor update)
- Target pricing: usage-based via Stripe, free viewing, paid creating
- Target customers: OpenClaw agent operators, power users at $200-500/day

### Engagement Model

**E = Q x I x R** (Quality x Interactivity x Relevance) — agents score high on all three dimensions.

### Dual Representation

> Every stream piece has a **visual form** (rendered for humans) and an **agentic form** (structured data for other agents to consume/compose).

The Spec type itself IS the dual representation — it's both renderable and machine-readable.

### Composability Vision

> Streams feeding into other streams; "Iran + AI + politics = news stream"

> "I want to look at prior art on other services that are offered mostly via or mostly for agents"

---

## 3. Protocol Design

### Current State (Imperative, Being Replaced)

The current protocol uses 6 generic MCP tools:
- `sceneSet` — full scene replacement
- `scenePatch` — RFC 6902 JSON Patch operations
- `stateSet` — sugar for patching state by JSON Pointer
- `sceneRead` — read current scene state
- `catalogRead` — read component catalog (Zod schemas → markdown prompt)
- `screenshotTake` — capture current visual state

### Where It Needs to Go (Declarative)

The user has been increasingly clear that the imperative set/patch model is failing:

> "We've got to move the entirety of this to more deterministic declarative rendering versus trying to iterate on something in this imperative approach"

> "I also think we still have just an astounding gap between the platform that we're building now and what the Remotion/Claude skill outputs I've seen look like."

> "What we really want is a declarative protocol that allows agents in an extremely token efficient way to describe complicated audio visuals"

> "We know FastLLM can do fast tool calls with enough context to make something interesting, we're just not there yet with our protocol."

### Key Protocol Requirements (from user's words)

1. **Token efficiency**: Scene templates should reduce ~1000 tokens per scene to ~100
2. **Faster-than-real-time**: Agent describes visuals faster than they play out
3. **Deterministic**: No screenshots-in-the-loop; output must be good on first pass
4. **Composable**: Other agents can read and remix the structured output
5. **Minimal surface area**: As few tools as possible for maximum visual results

> "I don't think we should be doing agents screenshotting their own outputs because by the time they would have done that it would have been seen by the users. So we're not trying to have them iterate on the visuals after the fact that it has to be good enough so that it just displayed well."

### Research Findings on Protocol

- **json-render** (Vercel): Closest direct analog. Flat element map with IDs, catalog/registry split, `$state` expressions — independently arrived at nearly identical architecture. json-render has additional features we lack: conditional visibility, event handling, repeat/list rendering.
- **Remotion**: Not a replacement (render-time, not real-time) but the Player component IS real-time. Remotion's skill system (37+ rule files) is the template for how to teach agents.
- **CasparCG**: The closest professional broadcast analog — HTML templates driven by data commands.
- **Smelter**: Closest prior art for the custom 4-layer architecture (tool calls → scene state IR → component catalog → layout templates).

### Timeline Tools (Added but Underused)

Timeline tools (`timelineAppend`, `timelinePlay`, `timelineClear`, `timelineRead`) were added to enable pre-planned sequences, but agents don't understand when to use them. They should be lazy-loaded to save tokens and promoted only for pre-planned sequences.

### Research-Recommended Tool Reduction

From the deep research agent: MCP tools should shrink from 11 to 4: `catalogRead`, `sceneSet`, `sceneAppend`, `screenshotTake`.

---

## 4. Rendering Architecture

### Current Architecture

```
Spec → Renderer → groups elements by slot → Layout (fixed grid)
              → per-slot: ElementRenderer (memoized)
                  → ResolvedElement: resolves $state expressions → looks up registry → renders
                  → ElementErrorBoundary wraps each element
StateProvider wraps everything, provides state via React Context
```

- WebSocket connection from browser to MCP server
- Express serves dist/, WebSocket on /ws sends snapshots and patches
- Single Node.js process runs both MCP stdio transport AND Express+WebSocket

### Remotion Direction

The user has seen Remotion outputs and wants to move toward it:

> "Remotion could be real time because we can just view what the player output is showing us"

> "The fact that we could just drop in a Remotion Live player could break us out of a lot of this custom hand rolled nonsense we have."

Key Remotion concepts identified:
- `@remotion/player` — real-time React component for video playback
- `TransitionSeries` — built-in transitions (fade, slide, wipe, flip, clockWipe, iris, cube)
- `spring()` and `interpolate()` — physics-based animations
- Frame-based rendering: visual state is pure function of (frame, inputProps)

### Font/Style Issues

The user has been vocal about visual quality problems:

> "The font situation is embarrassing." — research agent finding the user endorsed
> "Fonts are still too small... Typography is all whack."
> "The color theory is all over the place and this looks kind of like a sloppy, vibe coded like website more than it does a cutting edge motion graphics broadcast"

Current components use GitHub Dark Mode colors (`#161b22`), system fonts. Needs: Inter + Montserrat, named broadcast palettes, proper sizing.

### Broadcast Design Principles (from research, endorsed by user)

- Resolution-agnostic (vector/CSS, not bitmaps)
- Theme via CSS (broadcast systems style via simple CSS files)
- Dark theme default
- 60fps or nothing (transform/opacity for GPU acceleration)
- Monospace for data, sans-serif for labels
- Semantic color (red=alert, green=nominal, blue=info, amber=warning)
- Entrance/exit choreography on every element

---

## 5. Harness & Evaluation System

### Core Purpose

> "The harness is the development engine: run diverse agent scenarios → capture what they try to render → identify catalog/renderer gaps → build features to close gaps → repeat. Goal is autopilot — the repo improves itself through this loop."

### Agent Isolation (Proof of Blindness)

Agents must behave exactly as an external developer with only MCP tools and their workspace:

- Each scenario runs in `/tmp/stream-harness-<scenario>-<uuid>/`
- `.claude/settings.local.json` denies access to the stream repo
- `.mcp.json` points to stream server via absolute path
- `--disallowedTools` blocks filesystem escape
- Agents see only tool schemas via `catalogRead`, never implementations

### Pipeline

1. Agent spawns with restricted tools → calls catalogRead → operates scene
2. Recorder captures scene snapshots via WebSocket
3. Video capture records webm → converts to mp4
4. Gemini transcribes the video
5. Multi-pass evaluator scores the result
6. All output files generated in session directory

### Evaluation Requirements (User's Exact Words)

> "I basically want there to be an evaluation pass that knows nothing about Dazzle, knows nothing about the prompt, but is just a harsh critic of the stream itself as if there was any other video."

The user defined a multi-pass evaluation approach:

**Pass 1: Blind Critic** — Sees ONLY the rendered output. No knowledge of Dazzle, the prompt, or the component catalog. Judges like a viewer.

**Pass 2: Goal Evaluation** — Sees the original prompt AND the output. Measures task completion.

**Pass 3: Platform Gap Analysis** — Sees tool calls, errors, what the agent tried but couldn't. Feeds back into development.

Later evolved to:

> "I kind of went a holistic approach stepping back where we have an agent really look at all the information available, come up with how to evaluate against it. And the penultimate goal is to have a single document created for each of these sessions that is like the final markdown that says like here is all the behaviors we observed. Here is what went wrong."

> "Written as if by an extremely critical, well-informed reviewer."

> "I don't think we need action items or issues or anything like that. Like we can operate all in markdown space."

### Video Transcription Requirements

> "The scene description should be so accurate that a skilled video editor could remake it in exacting detail."

> "Raw experience transmitted into text is all we care about." (No quality judgments in transcription — that's the evaluator's job)

### Screenshot-Based Evaluation

User pushed for actual visual evidence in evaluation:

> "Maybe our video transcription is not good enough to get these results and we have to actually include screenshots of the major scenes. Like as part of our evaluation to Opus, like perhaps we can use key framings to get the like stable scenes screenshots and actually include those"

Solution: ffmpeg scene detection extracts keyframes from recorded MP4, feeds actual screenshots to evaluator.

### Evaluator Honesty

A critical bug was caught where the evaluator scored motion 8/10 based on specs (which declared animations) rather than what actually rendered (which had no motion). User's principle: **score what the viewer SAW, not what the spec declared**.

### Output Requirements

> "I can't see any of the screenshots. We need to make sure that everything gets dumped to a place where I can see it in sessions."

> "I want the ability to run it live, not really to replay it. I want to watch what it's doing."

> "The folder names. Can we do like ISO date time with time so that I don't have to try to parse a unique timestamp?"

### Framework Independence

> "I want to research how we can set up the harness to be as basically implementation independent as possible. We are likely to do some really vast changes to the actual mcp/acp surface area, and I just want to validate that we basically have the ability to swap in entirely new frameworks potentially and are able to evaluate them."

The harness is coupled to MCP in 5 specific places. Three interfaces would decouple it: `AgentDriver`, `VisualCapture`, `SceneObserver`.

### What Is NOT Acceptable (from HARNESS_SPEC.md)

- Card grids
- Centered-text-on-gradient
- Tiny fonts
- Hallucinated transcripts
- Sleeping/blocking the main thread

> "I absolutely resent more than anything else when you sleep for longer than like five seconds... Don't block the main thread. Ever. Ever, ever, ever, ever."

---

## 6. Agent Behavior & Scenarios

### Scenario Design Philosophy

> "I want basically a harness that these agents operate as if they have no outside knowledge of the repository we're working in and simply run their tests"

> "I want there to be enough variety that each of them drive different requirements"

### The Interaction Spectrum

> "I don't want it to be like each agent is just trying to operate, you know, like a dashboard. It's trying to create what's ultimately like a comprehensive video with continuity between scenes that's using the right cuts."

> "I don't want to just simulate an agent on its own acting. Like we need to also simulate a user interacting with their agent and the agent using dazzle to render effectively what they're doing to that user."

> "There's a spectrum I want to test which is like from completely autonomous agents with no use interactions to potentially even an agent running like some sort of choose your own adventure style stream where they're constantly providing feedback"

Spectrum:
- **Fully autonomous**: ambient-art, situation-monitor, devops-pipeline
- **Agent-driven with check-ins**: coding-game, onion-news
- **Highly interactive (simulated user)**: personal-agent, composable-stream

### Interactive Simulation Architecture

For interactive scenarios: two-agent architecture — a **Scenario Agent** that does work and renders, and a **User Simulator Agent** that plays the human. Uses `claude -p --input-format stream-json --output-format stream-json` for multi-turn interaction.

### Current Scenarios (12 total)

**Original 7:**
1. coding-game — Slither.io clone, streams progress
2. situation-monitor — Geopolitical monitoring (Iran)
3. onion-news — Satirical news broadcast
4. ambient-art — Generative visual compositions
5. devops-pipeline — CI/CD monitoring dashboard
6. personal-agent — Personal assistant streaming work
7. composable-stream — Multi-source news composition

**Added 5 (user insisted on NEW scenarios, not modifying existing):**
8-12. Additional scenarios for cinematic rendering, user interaction spectrum, and full creative range testing

**Hello-world** — Added as baseline proof:
> "I want a scenario that all the agent has to do is like print hello world, say hi, I'm Claude, hello, and then goodbye. Just some super basic shit to prove it's working."

### Scenario Requirements

> "And don't just slap this into existing scenarios, right? New scenarios. I'm worried that you're just like steamrolling scenarios with these new requirements when there really should be new scenarios."

Scenarios should be video-like experiences, not dashboards:
> "It's trying to create what's ultimately like a comprehensive video with continuity between scenes that's using the right cuts. Maybe it's a dashboard if it wants it, but it's very contextual based off what the agent wants to accomplish."

---

## 7. Templates & Catalog Architecture

### Catalog/Registry Split

- **Catalog** = Zod schemas (LLM-facing). `defineCatalog()` takes Zod schemas per component, returns `.prompt()` for system prompt generation.
- **Registry** = React implementations (renderer-facing). `defineRegistry()` maps catalog component names to React components.

This split was independently validated by json-render's identical architecture.

### Template System (Identified as Highest Impact)

> "Templates are the single highest-impact change." (Research agent finding)

7 template types cover ~80% of broadcast use cases:
1. Title Card
2. Data Reveal
3. Split Comparison
4. Data Dashboard
5. Lower Third
6. Breaking Alert
7. Closing Summary

Token cost drops from ~1000 to ~100 per scene. Templates enforce contrast (eliminates "dark text on dark background" errors).

### Styling Philosophy

From Conner's distilled docs:

> "I basically want the bones of the layouts to be -- layout should always be well designed and pretty uniform and the components should be pretty much describing their layouts accurately. But I do want there to be the ability for agents to sort of overwrite the aesthetics."

This maps to: components have good default styles, but accept `style` override props for per-stream customization.

### Component Taxonomy (from research, endorsed)

**Atoms**: Text, Shape, Media, Data indicators, Feedback (spinners, pulses)
**Molecules**: Cards, Broadcast (LowerThird, Ticker, ScoreBug), Charts, Time elements, Lists
**Organisms**: Dashboards, Broadcast layouts, Narrative patterns, Presentations
**Layout Primitives**: Grid, Split, Overlay, PiP, Stack, Center, SafeArea, Dock

### Current Component Gap

Only 6 domain-specific components exist (StatusBar, CodeView, DiffView, TerminalView, EventTimeline, ProgressPanel) — all coding-stream specific. Zero general-purpose primitives.

---

## 8. MCP/ACP Tool Surface

### Current MCP Tools

The system uses MCP (Model Context Protocol) with stdio transport. Claude Code auto-starts the server process, communicates via stdin/stdout. Side-channel web server runs Express + WebSocket for browser rendering.

Full tool list evolved to 11: sceneSet, scenePatch, stateSet, sceneRead, catalogRead, screenshotTake, timelineAppend, timelinePlay, timelineClear, timelineRead, validateSpec.

### User's Requirements for Tools

> "I don't want it to be too specialized towards this use case. I want you to consider all of the requirements we have earlier and work toward the more general implementation"

> "Those mcp tools are still a way too specialized for the coding use case." (Rejecting coding-specific tools)

> "What I'm really looking for is to speedrun the process of setting up an MCP that you're communicating with as you do work. That we have the basis for the catalog of components."

### Framework Flexibility

> "We are likely to do some really vast changes to the actual mcp/acp surface area"

The harness needs to support swapping MCP for ACP or other protocols.

### Key Improvements Identified

- **`holdMs` on sceneSet** — Agent thinking time is 10-15s of dead air. If sceneSet delays response, thinking overlaps with hold.
- **Auto-screenshot on sceneSet** — Force self-correction without separate tool call.
- **Element-level merge for scenePatch** — `addChildren: { "main": ["ticker"] }` instead of raw JSON Patch. Eliminates #1 runtime error category.
- **Lazy-load timeline tools** — Save 400-800 tokens/turn.

---

## 9. Multi-Agent Coordination Patterns

### Main Thread Discipline

> "I want you to use the cloud history tool to investigate my references to subagents and agentic workflows and cloud setup, etc. And I want you to apply some of those rules to this repository so that you in the main thread, stay just the master coordinator over groups of agents you're dispatching."

Rules enforced:
1. **Never block the main thread.** All agent work uses `run_in_background: true`.
2. **Worktree isolation.** Before using `isolation: "worktree"`, check if already in a worktree. Never nest worktrees.
3. **One merge at a time.** Sequential merges only.
4. **Build gate.** Agents must pass `npm run build` before declaring done.

### User's Frustrations with Agents

> "Yeah, spin up like six different agents though. I think you're being too timid with the amount of work we're doing in parallel."

> "I'm not even convinced we've had a single session passed fully all the way through. I haven't seen a video that works."

> "Like, you have to shepherd this to a completed single instance of a harness run where everything works as expected."

### Multi-Agent Workflow Pattern (from Dazzle experience)

The user developed a multi-agent coordination workflow used in the Dazzle repo:
- **Phase 1**: Compress existing knowledge into minimal shared docs
- **Phase 2**: Identify workstreams with clear ownership
- **Phase 3**: Set up workspace with STATUS.md per agent
- **Phase 4**: Write agent prompts with scope, shared context pointers, signal protocol
- **Phase 5**: Coordinator reads status files, routes decisions, resolves conflicts

---

## 10. Evolution of Thinking & Contradictions

### Screenshots-in-the-Loop

**Early**: `screenshotTake` was a core tool. Agent takes screenshots to verify its own rendering.

**Late**: User explicitly rejected this pattern:
> "I don't think we should be doing agents screenshotting their own outputs because by the time they would have done that it would have been seen by the users."

However, the research agent recommended auto-screenshots on sceneSet as a self-correction mechanism. **Resolution**: The user's concern is about agents iterating after-the-fact. Auto-screenshot as part of the tool response (not a separate call) may be acceptable.

### Imperative → Declarative

**Early**: Built the system around imperative sceneSet/scenePatch/stateSet.

**Late**: Strong push toward declarative:
> "We've got to move the entirety of this to more deterministic declarative rendering versus trying to iterate on something in this imperative approach"

This is the biggest architectural shift still in flight.

### Evaluation Approach

**Early**: Single LLM pass analyzing JSON (no visual input).

**Mid**: 3-pass evaluation (blind critic, goal eval, gap analysis).

**Late**: Single holistic evaluation producing one prose document per session:
> "I kind of went a holistic approach stepping back... the penultimate goal is to have a single document created for each of these sessions"

### Dashboards vs Videos

**Early scenarios**: Implied dashboard-like layouts (status bars, sidebars, panels).

**Late correction**:
> "I don't want it to be like each agent is just trying to operate, you know, like a dashboard. It's trying to create what's ultimately like a comprehensive video with continuity between scenes that's using the right cuts."

### First Target

**Original**: Situation monitor (Iran conflict monitoring)

**Changed to**: Agent work visualizer (Claude Code streaming what it's doing)

**Changed to**: Diverse scenarios via harness (the harness IS the development engine now)

---

## 11. Technical Specifications

### The Spec Format (Core Data Model)

```typescript
interface Spec {
  root: string
  elements: Record<string, UIElement>
  state: Record<string, unknown>
}

interface UIElement {
  type: string
  props: Record<string, unknown>
  children?: string[]
  slot?: string
}

type PatchOp =
  | { op: "add"; path: string; value: unknown }
  | { op: "replace"; path: string; value: unknown }
  | { op: "remove"; path: string }

type WSMessage =
  | { type: "snapshot"; spec: Spec }
  | { type: "patch"; patches: PatchOp[] }
```

### Expression System

`{ $state: "/json/pointer/path" }` in element props resolves against the spec's state store. Identical to json-render's approach. Planned additions: `$cond`/`$then`/`$else`, `$item`/`$index` for repeat rendering.

### Known Technical Issues

1. **scenePatch children corruption** — Agents consistently misuse JSON Patch, replacing arrays with strings
2. **Font sizing/scaling** — Container queries or percentage fonts needed for stable aspect ratio
3. **WebSocket reconnect storms** — Fixed via useMemo, but architectural fragility remains
4. **Dead air between scenes** — Agent thinking time (10-15s) creates gaps. Need `holdMs` or template system to fill.
5. **No animation system** — Static renders only. No enter/exit transitions, no motion.

### Cost Model

- Chrome sandbox: $0.04-0.07/hr per stream on reserved instances
- 8-10 concurrent streams per 16-core machine
- OpenAI mini-tts: ~$0.08/hr for narration
- Total per stream: ~$0.18/hr with narration, $0.10/hr without

### Key Research Documents (in repo)

- `/Users/cruhl/GitHub/stream/docs/agentic-broadcasting-spec.md` — Master synthesis
- `/Users/cruhl/GitHub/stream/docs/distilled/*.md` — 14 distilled requirement files (2,493 lines)
- `/Users/cruhl/GitHub/stream/docs/research/*.md` — 5 research documents
- `/Users/cruhl/GitHub/stream/DECLARATIVE_RENDERING_RESEARCH.md` — Remotion migration research (~1253 lines)
- `/Users/cruhl/GitHub/stream/harness/HARNESS_SPEC.md` — Harness specification (AI-generated, user notes "I don't necessarily trust it")

### Build & Configuration

- TypeScript, Vite for bundling
- Zod v3 (downgraded from v4 for MCP SDK compatibility)
- React 19
- MCP server configured via `.mcp.json`
- Express 5 for web server (uses `"/{*splat}"` syntax)
- Vercel AI SDK v6 for agent spawning in harness

---

## Appendix: Key Direct Quotes by Topic

### On Quality

> "The color theory is all over the place and this looks kind of like a sloppy, vibe coded like website more than it does a cutting edge motion graphics broadcast"

> "Fonts are still too small... Typography is all whack."

> "This is some of the most fucked up code I've ever seen." (on ASI hacks and `as Record<string, unknown>` casts)

### On the Harness

> "The harness is the development engine: run diverse agent scenarios → capture what they try to render → identify catalog/renderer gaps → build features to close gaps → repeat. Goal is autopilot — the repo improves itself through this loop."

> "I'm not even convinced we've had a single session passed fully all the way through. I haven't seen a video that works."

> "I want, if we don't have a scenario for this yet, I want a scenario that all the agent has to do is like print hello world"

### On Evaluation

> "I basically want there to be an evaluation pass that knows nothing about Dazzle, knows nothing about the prompt, but is just a harsh critic of the stream itself as if there was any other video."

> "The penultimate goal is to have a single document created for each of these sessions that is like the final markdown"

> "Written as if by an extremely critical, well-informed reviewer."

### On Protocol

> "What we really want is a declarative protocol that allows agents in an extremely token efficient way to describe complicated audio visuals"

> "We know FastLLM can do fast tool calls with enough context to make something interesting, we're just not there yet with our protocol."

> "I don't think we should be doing agents screenshotting their own outputs because by the time they would have done that it would have been seen by the users"

### On the Platform Vision

> "We're transitioning dazzle.fm into a platform for agent streams"

> "I really want sort of an agent first view of the platform. So I want to look at prior art on other services that are offered mostly via or mostly for agents"

> "Is there a declarative way to describe remotion such that we can ultimately render components to it. Do we need our own data model?"

### On Agent Workflow

> "I absolutely resent more than anything else when you sleep for longer than like five seconds... Don't block the main thread. Ever. Ever, ever, ever, ever."

> "Spin up like six different agents though. I think you're being too timid with the amount of work we're doing in parallel."

### On What Must Survive the Move

> "I want this continued ability to have these extremely rich evaluations of scenarios we can use to push the protocol forward and I don't really care how the protocol is implemented in the new repository but I do want the ability to maintain this level of end to end iteration and perform these tests."
