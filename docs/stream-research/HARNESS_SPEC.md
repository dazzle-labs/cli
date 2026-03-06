# Harness Specification

## What This Is

The harness is an automated testing and development loop for the stream platform. It spawns AI agents against scenarios, records everything they produce, evaluates the output, and identifies gaps in the platform's component catalog. The core loop is: run scenario → evaluate output → identify missing capabilities → build them → repeat.

The stream platform gives agents a real-time visual rendering surface via MCP tools. Agents compose scenes from a component catalog, and viewers watch the result as a live web page or recorded video. The harness exists to push this platform forward by finding out what breaks, what's missing, and what looks bad.

## Why It Exists

Agents can't improve at visual composition if nobody watches their output and gives structured feedback. Manual testing is too slow. The harness automates the full cycle: an agent tries to create something, the system captures video and scene data, an evaluator scores it honestly, and a gap analysis identifies what components or features would have made the output better. This feedback drives catalog development.

## Core Principles

**The user's time is sacred.** The harness must never waste human attention. No sleeping, no polling, no ambiguous hangs. If something is broken, detect it immediately, report it clearly, and stop. The user should be able to launch a scenario, glance at the output, and know within seconds whether it's working.

**Agents discover their tools organically.** Scenario prompts describe what to create, not how to use the platform. Agents call `catalogRead` to discover available components, then compose scenes using what they find. Prompts should read like creative briefs, not API documentation.

**Streams are cinematic, not dashboards.** The default output is a video-like experience with narrative arc, deliberate pacing, and intentional transitions. A dashboard layout is appropriate when the scenario calls for one (mission control, monitoring), but agents choose the format based on context. The distinction between scene cuts (`sceneSet`) and scene evolution (`scenePatch`/`stateSet`) is the primary creative tool for pacing.

**Fail fast, fail loud.** Startup deadlines kill agents that never produce output. Silence timeouts kill agents that stall. MCP server failures are detected on the first line of output. Port collisions are cleaned up before launch. Every detectable failure mode has a specific check that runs immediately, not after an arbitrary delay.

**One clean run beats ten broken ones.** Before running a batch, verify a single scenario end-to-end. Every artifact must be real: the video must show actual content (not a waiting screen), the transcription must describe what's actually in the video, and the evaluation must reflect the actual output.

## Scenario Design

Each scenario is a creative brief in `prompt.md` that describes what the agent should create, with quality references and pacing expectations. The prompt never mentions tool names or platform internals. Interactive scenarios add a `persona.md` describing the simulated user and a `config.json` with allowed tools.

Scenarios span a spectrum: fully autonomous (agent works alone) to highly interactive (simulated user drives choices). They cover diverse formats — generative art, broadcast news, mission control, live coding, personal assistant — to stress-test different parts of the catalog.

New requirements get new scenarios. Existing scenarios are never overwritten to serve a different purpose.

## Evaluation

Three independent passes, each with a different perspective:

1. **Blind media critic** — Knows nothing about the platform, tools, or scenario prompt. Judges the stream purely as visual media, like reviewing any video. Scores visual polish, pacing, engagement, and production quality.

2. **Task completion** — Compares the scenario's goals against what the agent actually produced. What was attempted, what succeeded, what failed, what was never tried.

3. **Platform gap analysis** — Identifies what the agent couldn't do because the catalog lacks the right components. This is the most actionable pass — its output directly drives what to build next.

Evaluation runs via direct LLM calls, not spawned processes. Results are saved alongside all other session artifacts in a single directory.

## Quality Bar

Acceptable output has coherent narrative arc, intentional transitions, rich component usage, curated color palettes, and production quality matching the scenario's reference bar.

Not acceptable: static layouts with no progression, card grids as a default composition, centered-text-on-gradient, random colors, tiny broken fonts, agents that produce no visual output, videos showing only a waiting screen.

## Operational Requirements

- The harness runs through Claude Code. The main thread coordinates; all work is dispatched to background agents.
- A single scenario must be runnable with one command. The user should never have to remember obscure flags.
- Live viewing via browser URL, printed immediately on start.
- Session output includes: MP4 video, replay HTML, scene snapshots, tool call log, evaluation results, video transcription.
- Video must capture actual rendered content at configurable resolution and aspect ratio.
- Agents run in isolated workspaces with no access to the stream repo. Only MCP stream tools are available unless the scenario explicitly needs web search or filesystem access.
- The agent's self-observation loop (`sceneRead` + `screenshotTake`) lets it see and iterate on its own output. This feedback loop is a core architectural advantage.
