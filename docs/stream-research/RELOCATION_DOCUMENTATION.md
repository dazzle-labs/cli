# Relocation Documentation

This repo (`stream`) is being merged into John's `agent-streamer` repo. This document captures Conner's intent, goals, and context so the next agent can do the move correctly.

## Conner's Raw Requirements (verbatim, speech-to-text)

> Okay, so we're about to do a massive lift and ship of the repository I've been working on here in stream into John's agent streamer repo. Agent streamer repo is set up with all of the rendering architecture and a bunch of pre done work on key management. The front door has stubs for landing page, etc. So what we need to do is sort of unify this work. I'm going to try to specify as best I can what were my goals and intentions for this project and what parts we need to keep, what parts are still in flight, etc. to help give context for the next agent that's doing this. So in general, the goal of this repo has been to set up a harness by which I can create enough scenarios with enough complexity to start driving the ultimate protocol that agents use to communicate their intent and operate a video live stream. We have two kind of core requirements that I'm trying to enable with this repo. One is I want the ability to sort of evaluate using the harness all aspects of the platform in the end so that I can have scenarios like play this news broadcast and then have other LLMs and AI processes evaluate the actual outputs against what was intended to really harsh criticism and judgment on visuals, timings, everything. That way we could sort of automatically iterate on the protocol and the implementation at the same time against a set of scenarios that we can score. So there's a bunch of infrastructure around that in the harness that is somewhat well described by the harness spec that's AI generated so I don't necessarily trust it. So there's a bunch of my distilled thoughts in the research or docs/distilled but I'm going to trigger another round of documentation adding that's basically relevant to this specification. But basically the words I'm saying now are more important. This repo is in a state of flight. The protocol is definitely not well specified enough. It currently uses a sort of iterative approach but what we really want is a declarative protocol that allows agents in an extremely token efficient way to describe complicated audio visuals using, you know, there's a lot of precedent for this like in remotion and JSON render that we're taking inspiration from but ultimately what we're looking for is something that allows agents to describe faster than real time these audio visuals that can then get interpreted by both a visualizer and can be interpreted and composed by other agents so into other streams. So all in all I guess the most important things let me try to restate it just to make sure we know it was the context. I want this continued ability to have these extremely rich evaluations of scenarios we can use to push the protocol forward and I don't really care how the protocol is implemented in the new repository but I do want the ability to maintain this level of end to end iteration and perform these tests. So I'm going to trigger another agent to do background research into all of the other specifications I've been working on over the last two days to give more important context and I'm going to put that in doc/relocation context but this is that's the main thing I want to end with. We're going to put this message in a markdown document combined with other LLM generated commentary on this whole move into the root under a relocation documentation markdown and hopefully that's enough to get this repository moved.

## What Must Carry Over

The **evaluation harness**. This is the core deliverable of this repo. The ability to:
- Define scenarios as creative briefs (prompt.md + config.json)
- Spawn an AI agent against a scenario in an isolated workspace
- Capture everything: video, scene data, tool calls, console errors
- Evaluate output via LLM with 3 independent passes (blind media critic, task completion, platform gap analysis)
- Score and compare across runs to measure progress

The harness must remain **implementation-independent**. It should be able to evaluate whatever rendering/protocol approach wins, not just the current one. The harness evaluates outputs (video, visual quality, pacing), not internal protocol mechanics.

## What Is Open / In Flight

**Everything about the protocol is open to radical change.** The current Spec/patch/snapshot model, the MCP tool surface, the component catalog structure — none of this is sacred. These are starting points that produced learnings, not final designs.

Active research directions (none decided):
- **Remotion** — promising for declarative rendering and real-time playback, but still being investigated. May or may not be the winner.
- **json-render patterns** — Vercel's flat spec + catalog + JSONL patch streaming. Heavily influenced the current design.
- **Template/composition system** — agents describe intent with ~100 tokens instead of ~1000 tokens of raw JSON. 7 template types sketched out.
- **ACP / multi-agent composability** — agents consuming other agents' streams
- **Audio** — TTS, background music, sound design. Research exists, nothing built.
- **Protocol surface area reduction** — current 11 MCP tools may shrink to ~4

## Design Goals (Not Implementations)

These are the things we're trying to achieve regardless of which tech wins:

1. **Token efficiency** — agents must describe complex audiovisuals with minimal tokens, faster than real time
2. **Declarative over imperative** — agents describe what they want, not how to build it step by step
3. **Composability** — agent output must be consumable by other agents, not just human viewers
4. **First-render quality** — no iterative screenshot-and-fix loops; output must be good on first display
5. **Framework independence** — the evaluation layer must survive renderer swaps, protocol changes, model changes
6. **Cinematic quality** — output should look like broadcast media, not dashboards

## Current Scores (Baseline)

These exist to measure whether the migration makes things better or worse:

| Scenario | Score | Notes |
|----------|-------|-------|
| hello-world | 6.5/10 | Basic, works after WebSocket fix |
| cinematic-broadcast | 3/10 | Agent-level composition issues, gradient text invisible in headless Chrome |

## Known Problems

- Agents consistently misuse JSON Patch semantics (children array corruption)
- Imperative set/patch model is fundamentally error-prone for LLMs
- Cinematic output quality is poor — agents struggle with visual composition at scale
- Code quality in the renderer/patch layer was rough (partially cleaned up)

## Where to Find More Context

All of these are in this repo. Read them for deeper context on any topic:

| Path | What It Covers |
|------|----------------|
| `SPEC.md` | Current protocol spec (Spec tree, components, mutation primitives) |
| `DECLARATIVE_RENDERING_RESEARCH.md` | Remotion deep dive, template designs, migration plan sketch |
| `harness/HARNESS_SPEC.md` | Evaluation harness design and principles |
| `docs/distilled/` | 15 distilled requirement docs covering agent contracts, rendering, MCP, composability, aesthetics, pricing, channels |
| `docs/research/` | 8 research docs on ACP, content formats, json-render, composability protocols, audio, Chrome streaming |
| `docs/agentic-broadcasting-spec.md` | Consolidated agentic broadcasting specification |
| `docs/timeline-design.md` | Timeline/elapsed playback system design |
| `harness/scenarios/` | Scenario definitions with prompts and configs |
| `src/core/catalog.ts` | Current component catalog (31 components, 8 categories) |
| `docs/relocation-history-context.md` | 588-line compilation of Conner's raw quotes and decisions from 2 days of sessions, organized by topic |
