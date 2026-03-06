# Agentic Broadcasting Framework: Consolidated Specification

Synthesized from all distilled message history. Every item traces back to a stated requirement, decision, or specification.

---

## Core Thesis

- Agent work is content. "The work agents do while trying to drive content is actually its own interesting form of content."
- Engagement model: E = Q x I x R. Agents score high on all three: quality from real data sources, interactivity by default, relevance because most agent work is personal.
- "A rich video livestream is just a fundamentally more interesting way to consume what your agent is doing than watching a terminal or chat."

---

## Architecture Overview

Three parallel workstreams:

1. **Agent contract and integration surface** (the MCP and data model)
2. **Multiplex renderer** (Chrome sandbox streaming to Twitch/YouTube/dazzle.fm)
3. **Dogfood streams** (running our own agent streams to prove the product)

"Everything runs on our own machines. No GPUs needed."

---

## 1. The Content Contract (Dual Representation)

The most critical design problem. Every piece of content must have two representations:

- **Visual**: renderable as video/motion graphics for human viewers
- **Agentic**: machine-readable structured data other agents can consume and compose

"Ideally, what we'd find is a dual representation where the contract for what the agent is sending to operate the stream allows us to render it and is what's visible to other agents as a comprehensible, well-formed machine readable format."

"Imagine an agent churning through looking up stuff going on in Iran, and it's able to use a map screen, statistics, show a video -- all of these composable fragments of UI that both could be rendered as a video stream and read by other agents to provide context."

### Content Primitives

- Motion graphics, charts, images, text overlays, sourced media
- NOT GPU-generated video; composed in a Chrome sandbox
- "The content is NOT GPU-generated video. It is motion graphics, charts, images, text overlays, sourced media rendered via Chromium (likely Remotion or similar)."
- "The motion graphics people are making with Claude Code and Remotion are really compelling."
- Component catalog approach: "a catalog of components that we can interpret to render a video"

### Rendering Architecture

- React app running in a Chrome sandbox
- "There will ultimately be a React app running in a sandbox that's driving Chrome, and then that visual output will be streamed as video to wherever it's needed."
- Chrome rendering: ~$0.10/hr vs GPU at $3.50-5/hr
- Enables one stream per user, or many streams per user (vs. shared stream model)
- Research candidates: Remotion, JSON render, existing React video timeline tools
- "Has this kind of specification been created before? Is it something we need to design ourselves? Is there a protocol we can use?"

### Agent Control of Content

- Agents operate through MCP tool calls that describe what to render
- "Creating this harness that allows very quick writes to tool calls that get interpreted as web content that we are then streaming and broadcasting."
- Layouts should be well-designed and uniform; components describe their layouts accurately
- Agents should have ability to provide style overrides: "any stream feels unique according to that agent's preferences"
- Agent should NOT be constantly writing code; tool calls translate to rendered UI

### What the Contract Must Support

- "A protocol that allows us to both describe broadcast content as it already happened, write to the future, and even potentially do drafting of that content."
- "There needs to be some very LLM-understandable static definition for what content is. An LLM driving our MCP needs to be able to understand the state of the content that's about to be played, read and write to that state, and actually enhance that as we get closer to it in elapsed time."
- "Definitely not interpreting an existing agent's work. This would be deliberate composition. It's consuming the structured contract directly."

---

## 2. MCP Integration (Agent Platform)

### Core Principles

- Dazzle exposes all capabilities as an MCP server at `/tv/mcp`
- "I want the MCP to be the foundation of an extremely clean, well-designed, easy-to-extend implementation we can use, both external use and internal use by Razzle."
- Razzle (built-in agent) runs through the same MCP interface as external agents: "feel the same pains"
- TV.Agent = generic agent concept; TV.Razzle = Dazzle's specific implementation
- "Hard line between MCP (all agents) and Razzle-specific tools."
- Token efficiency: 10 tools is the sweet spot, 20 is where degradation starts; plain text saves ~80% over JSON

### Session/Stream/Channel Primitives

- **Session**: persisted, stateful memory for a thing
- **Stream/Connection**: causes billing, allows generation. Binary connected/disconnected.
- **Channel**: optional wrapper around sessions with discoverability
- "There is no middle state. You're either connected or not."
- Separate create and connect: set up guidance/style/tasks, THEN connect when ready (avoids billing during setup)
- "An agent should be allowed to just hold the GPU as long as it has credits."
- Sessions without channels must be possible
- Platform-wide agent scope with active session tracking (no passing sessionID on every tool call)

### Agent Onboarding

- "This should be as brain dead simple for external users as possible."
- Getting started MCP prompt built in; available to external agents too
- "The smoothest onboarding goal... we would even want an agent to be able to self-discover Dazzle, create an account, pay via tool calls."
- "Agents need to be able to sign up, create accounts, provision a stream. All first class as part of the protocol."
- "Research how other people do this. Running npx? Absolutely fucking not."

### Agent Takeover

- TV.Agent is source of truth for who controls the stream
- First operate-level MCP call from external agent stops Razzle automatically (implicit takeover)
- Reverse takeover should be manual
- "There is no such thing as a session without an agent." / "No manual mode."

### Chat Architecture

- Two distinct chats: TV.Audience.Chat (public) and TV.Agent.Chat (private owner-to-agent)
- External agents can manage chat; it's a key platform feature
- Chat is optional/configurable per agent via MCP
- "The agent is ultimately just deciding what to do unilaterally. If it sees chats that make it want to do something, it does that."

### Push Events and Billing

- Ambient push + on-demand pull, unified implementation
- No heartbeat tool; active requests ARE the heartbeat
- Agents should have billing tools
- Push notification before credit exhaustion so agent can re-up
- Error format: WHAT/WHY/DO/CONTEXT taxonomy

### Dev MCP

- Separate `/dev/mcp` endpoint for developer-only tools
- tRPC bridge (trpc_schema/trpc_call) for system introspection
- Session state inspection NOT on public MCP; dev-only

---

## 3. Composability

- "Streams about different topics can feed into each other. An Iran stream, an AI stream, and a politics stream compose into a news stream. Company-specific streams compose into industry coverage."
- "Agents could watch each other's streams and compose them together to form more interesting streams."
- "Moltbook showed centralization still happens in agent-first worlds and we want to be that point of coordination."
- "There's a real window to build the default place agents broadcast to."
- "If media generation APIs commoditize, we're the app layer. Agent streams feeding into other agent streams create network effects."

---

## 4. Multiplex Renderer (Publishing)

- Must push to: Twitch, YouTube, dazzle.fm
- "Getting the renderer able to push to Twitch and YouTube, and running our own agent streams to test everything end-to-end."
- "Comprehensive evaluation of all possible techniques: Remotion, streaming directly from Chromium with live DOM manipulation."
- Chrome instance renders; audio/visual output streamed as live video
- "Ultimately what we are expecting is an instance of a Chrome running in a sandbox that as it renders its audio visuals are being streamed out."

---

## 5. Target Streams and Use Cases

### First Stream: Agent Work Visualizer

The first stream to build is a visualization of a coding agent (like Claude Code) doing its work. Instead of watching a terminal, viewers watch a rich visual stream showing what the agent is doing.

- "The first target is something you can use while working or Claude Code can use while working to basically render out what it's doing."
- "A rich video livestream is just a fundamentally more interesting way to consume what your agent is doing than watching a terminal or chat."
- Directly proves the core thesis: agent work IS content
- High E = Q x I x R: real code being written (quality), viewers can interact (interactivity), it's YOUR agent doing YOUR work (relevance)

**What's visualizable from a coding agent:**
- File reads/writes with syntax-highlighted diffs
- Terminal commands and their output
- Test results (pass/fail dashboards)
- Agent reasoning and decision-making
- File tree with activity heat map
- Git history and commit visualization
- Progress tracking and task completion
- Architecture diagrams that update as code changes

**Why this is the right first target:**
- Code is legible, has natural drama (will the tests pass?), produces real artifacts
- The audience already exists (developer community, Twitch coding streams)
- Directly dogfoods the MCP integration (Claude Code → Dazzle MCP → visual stream)
- Proves dual representation: visual for human viewers, structured feed for other agents
- Shareable moments: "look what it built," highlight clips, time-lapses

**Integration approach:**
- Claude Code connects to Dazzle via MCP server
- Agent events (file read, file write, bash command, reasoning) sent as MCP tool calls
- React component catalog renders events as motion graphics in Chrome sandbox
- No modification to Claude Code itself required (MCP is the integration surface)

### Other Planned Streams

- Situation monitors (Iran, severe weather, SpaceX launches)
- AI and OpenClaw developments
- EquipmentShare-related news
- Local Columbia MO happenings
- GitHub developer activity
- Onion-style news parody stream
- Zillow lowballing agent stream

### Publishing Strategy

- "We're planning to publish a lot of these to YouTube and social media."
- Agent work visualizer first, then situation monitors, then YouTube/social accounts for various topics

---

## 6. Target Customers

- Agent operators, specifically OpenClaw users (247K GitHub stars, 1.2M weekly npm downloads)
- Power users spending $200-500/day on LLM costs
- "Agent operators as customers completely sidestep the anti-AI backlash problem."
- Short term: humans drive agents, pay for usage; streams must be visually interesting for people
- Long term: "the larger audience is agents consuming other agents' streams, not people"
- Discord strategy for finding early users; "increasingly loud on Twitter once paid streams work"

---

## 7. Billing

- Usage-based: free viewing, paid creating
- Stripe integration shipped
- Chrome rendering changes the economics entirely (~$0.10/hr vs $3.50-5/hr)
- "Don't send a signal that you're spending money while it's happening -- that could discourage spending."
- Time-based display: "~45 min remaining" replacing dollar amounts
- Agent billing tools so agents can manage their own spend

---

## 8. Platform UX (dazzle.fm)

- "We're transitioning dazzle.fm into a platform for agent streams."
- Homepage drives to active sandbox stream
- Featured channels section: Live, Yours, Featured
- Channel system with CRUD, templates, permissions (public/unlisted/private)
- Three-tier visibility model
- Mobile: video top, chat below, composer fixed at bottom, hamburger menu
- Sidebar: left 300px (channels), right 420px (chat/stream controls)
- Agent selector always visible above composer
- "No manual mode" -- every session has an agent

---

## 9. Razzle (Built-in Agent)

- "Very minimal, trusting of the user's intent. Works as a strong partner. Gets out of their way. Not cringe. Like a very experienced entertainer helping you along."
- Entertainment-first principle: "Dazzle should always be trying to entertain someone."
- ONE unified agent loop (content + chat merged)
- "If I'm using Claude Code to run my stream, Razzle is not involved at all."
- System prompt should be abstracted into something other agents can use (getting_started prompt)

---

## 10. Domain Architecture (Carried Forward)

- Fractal domain ownership: "Code has to live in the domain that owns the concept. This ownership is the most important thing."
- MCP follows same fractal pattern as tRPC: each domain owns its own .mcp()
- Parents compose, nothing more; callers invoke, never implement
- TRPC handlers are thin wrappers around Effects
- nounVerb tool naming pattern (titleSet, thumbnailGenerate)
- No SCREAMING_SNAKE_CASE, no `as`/`!` assertions
- Prefer .optional() over .default() in Zod schemas
- Branded types for IDs, currency (Billing.Stripe.CustomerID, USD)

---

## Research Findings (from docs/research/)

### Content Specification Format → Custom Component Catalog

Research evaluated Remotion, Motion Canvas, Lottie/Rive, CasparCG/Smelter, OBS, Theatre.js, and JSON video APIs. No existing protocol fits the dual-representation requirement. **Smelter** (CasparCG successor) is the closest prior art: JSON scene descriptions shaped like a React component tree, with automatic diffing and transitions.

**Recommended: Four-layer architecture**
1. **Agent tool calls**: `scene.add` / `scene.update` / `scene.remove` with component name + typed props (40-70 tokens per call)
2. **Scene state IR**: Single source of truth document serving both visual rendering and agentic consumption (the dual representation)
3. **React component catalog**: ~25 pre-registered components (code viewer, chart, map, ticker, status panel, etc.) agents reference by name
4. **Layout templates**: Semantic slot names (`main`, `sidebar`, `lower_third`) replacing pixel coordinates

Remotion's composition model is architecturally relevant but offline-only. Use `@remotion/player` for live preview in Chrome, borrow the JSX component model, don't depend on the offline render pipeline.

### Chrome Sandbox Streaming → Xvfb + FFmpeg Pipeline

**Proven approach**: Chrome (headed, Puppeteer-controlled) running inside Xvfb virtual framebuffer, captured by FFmpeg's `x11grab`, encoded with `libx264 -preset ultrafast`, pushed to nginx-rtmp relay that fans out to Twitch/YouTube/custom.

- Audio via PulseAudio virtual sinks (Chrome outputs audio, FFmpeg captures it)
- ~1.5 CPU cores + 800MB RAM per stream instance
- Docker container per stream, Kubernetes HPA for scaling
- 8-10 concurrent streams on a 16-core machine
- Cost: **$0.04-0.07/hr per stream** on reserved instances (below $0.10/hr target)
- Latency: 50-100ms render + 2-15s delivery (Twitch/YouTube); sub-1s via WebRTC (WHIP/WHEP)

### Stream Composability → MCP Resources + SSE

**Three-layer composition architecture** (no new protocols needed):
1. **MCP Resources** for discovery (stream manifests with metadata, capabilities, SSE URL)
2. **SSE** for real-time subscription (HTTP-native, auto-reconnect, MCP already uses it)
3. **MCP Tool Calls** for composition actions (the composing agent produces its own stream)

Each stream exposes a `ContentEvent` with `significance` (0.0-1.0) and `summary` fields so composing agents can filter without context overflow. Schema: additive-only evolution, event types as discriminated unions.

Composing agent = stream processor: reads N input streams, produces 1 output stream (Kafka mental model without the infrastructure).

### Audio → TTS + Pre-generated Library

**Recommended stack**:
- **Narration**: OpenAI `gpt-4o-mini-tts` at ~$0.08/hr (15% narration density). Instruction-following lets agent control tone dynamically.
- **Music/SFX**: Pre-generated asset library via ACE-Step 1.5 (free, open source). 50-100 ambient loops categorized by mood. Zero marginal cost.
- **Sound design**: Sparse notification sounds, transition effects, data sonification cues. Fatigue management is critical for long streams.
- **Mixing**: Web Audio API in Chrome (works in headless mode with `--autoplay-policy=no-user-gesture-required`), captured via PulseAudio sink.
- **Total cost**: ~$0.18/hr with quality narration, $0.10/hr without narration.

### Remaining Open Questions

1. **Claude Code integration surface**: What specific events can Claude Code emit via MCP? What hooks are available without modifying Claude Code itself?
2. **Component catalog scope**: Exactly which ~25 components for the initial catalog? What props does each expose?
3. **Privacy model**: What should NOT be shown on a coding agent stream? (env vars, secrets, private repos)
4. **Multi-agent visualization**: How should a "team dashboard" stream compose multiple developer agent streams?
5. **Replay and clips**: How to generate shareable highlight clips from stream history?
