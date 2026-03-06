# Stream Composability Protocols: Research

How one agent's stream feeds into another agent's stream. Evaluated against: simplicity, LLM-friendliness, real-time capability, and whether agents can easily consume and produce the format via tool calls.

---

## The Problem

Every stream has a dual representation: visual (rendered video) and agentic (structured data). Agents need to:

1. **Produce** structured stream output alongside visual rendering
2. **Subscribe** to other streams' structured output in real time
3. **Compose** multiple input streams into a new output stream
4. **Operate via tool calls** without needing to understand transport internals

The contract an agent uses to *drive* a stream should be the same contract another agent *reads* to consume that stream. One format, two directions. Critically, the composing agent is consuming the structured contract directly, not interpreting an existing agent's rendered output.

---

## Part 1: Existing Composition Protocols

### 1.1 ActivityPub / ActivityStreams

ActivityStreams 2.0 is a JSON-LD vocabulary for describing social activities. ActivityPub is a federation protocol built on top of it. The core model:

- **Actors** have an **inbox** (receives activities) and **outbox** (publishes activities)
- **Activities** are typed actions: Create, Update, Delete, Announce (boost), Like
- **Objects** are the content: Note, Article, Image, Video, Collection
- **OrderedCollection** and **OrderedCollectionPage** provide paginated feeds
- Delivery: server POSTs an Activity to each follower's inbox. Pull: GET an actor's outbox

Composability in ActivityPub is limited to social primitives: Announce (share/boost), replies (inReplyTo), and collections. There is no native concept of "compose stream A and stream B into stream C."

**The inbox/outbox pattern is directly useful.** Each stream has an outbox (its structured content as it's produced) and an inbox (commands from other agents). This maps cleanly to how MCP already works: tool calls go into the stream, structured events come out.

**ActivityStreams vocabulary is too social.** The types (Note, Article, Like, Announce) are designed for social media, not for composable broadcast content.

**JSON-LD overhead is hostile to LLMs.** Every ActivityStreams object carries @context, @type, and IRI identifiers. This is 3-5x more tokens than plain JSON for the same information. LLMs don't benefit from semantic web metadata; they benefit from clear field names and compact structure.

**Verdict**: Borrow the inbox/outbox topology. Ignore the vocabulary and JSON-LD serialization. The pattern of "every actor has an outbox you can poll or subscribe to" is the right shape. The specific format is wrong.

---

### 1.2 RSS/Atom Feed Aggregation

RSS 2.0 and Atom are XML-based syndication formats. A feed is an ordered list of entries, each with title, content, timestamp, and a unique ID. Consumers poll the feed URL at intervals. No push mechanism is built in (WebSub/PubSubHubbub was bolted on later for real-time).

Key properties:
- Dead simple: a URL returns a list of items
- Universal: every feed reader, aggregator, and automation tool speaks it
- Stateless: no subscription handshake, just GET the URL
- Composable by design: feed aggregators merge multiple feeds into one

The entire RSS ecosystem was built around merging, filtering, and transforming feeds. Yahoo Pipes (RIP) let non-programmers compose feeds visually. The mental model of "take these three feeds, merge them, filter by relevance, produce a new feed" is exactly what agent-to-agent composition looks like.

**The "feed as URL" model is exactly right for read-side consumption.** An agent that wants to observe another stream just needs a URL that returns structured content items. No handshake, no connection management, no protocol negotiation.

**XML is the wrong format.** JSON is what LLMs and tool calls produce/consume natively. JSON Feed (jsonfeed.org) is a direct JSON analogue to RSS: a simple, well-documented format with `items` arrays, typed content, and GUIDs. But we'd want our own content types rather than adopting the spec wholesale.

**Polling is too slow for real-time.** A live stream produces content continuously. But a hybrid model (SSE for real-time push, with a feed URL for historical catchup) gives you both live and catch-up consumption from the same data.

**Verdict**: The feed model is the right abstraction for the read side. Expose each stream's structured content as a JSON feed (ordered list of typed entries). Use SSE on top of that same data shape for real-time push.

---

### 1.3 Apache Kafka and Stream Processing Patterns

Kafka models data as append-only logs partitioned into topics. Producers write events; consumers read from offsets. Key patterns:

- **Topics as streams**: each stream is a topic
- **Consumer groups**: multiple consumers each get a full copy of a topic
- **Compaction**: latest value per key survives (useful for state snapshots alongside the event log)
- **Stream processing** (Kafka Streams, ksqlDB): transform, join, and aggregate topics into new topics

The stream-of-streams pattern: topic A and topic B are joined/merged via a stream processor to produce topic C. This is the exact pattern Dazzle needs for composability.

Kafka itself is overkill infrastructure for this. But the patterns translate directly:

**Log-based composition.** Every stream's output is an ordered, append-only log of events. Composition is reading from multiple logs and producing a new one. This is the mental model regardless of transport.

**Consumer offsets.** Each consuming agent tracks where it is in each source stream. If it disconnects, it resumes from its last offset. This maps to SSE's Last-Event-ID.

**Stream processing topology.** Source streams -> processor -> output stream. The processor is the composing agent. Its "processing logic" is its LLM reasoning about what to include, how to arrange it, what to emphasize.

**Windowed aggregation.** For a news aggregator stream, the composing agent doesn't need every event from every source. It might aggregate the last 5 minutes of updates from each source into a segment.

**Snapshot + log (log compaction analogue).** Kafka log compaction keeps only the latest value per key, effectively producing a snapshot. Applied to Dazzle: every stream should expose both a current-state snapshot (what's on screen right now) and an event log (everything that happened). New subscribers read the snapshot first, then tail the event log. This solves the "joining late" problem without replaying hours of history.

**Verdict**: Don't deploy Kafka. Adopt the log-based composition mental model and the snapshot+log pattern. Each stream is an append-only log of typed events with a current-state snapshot endpoint. The transport is SSE; the pattern is Kafka-style stream processing.

---

### 1.4 Reactive Streams / RxJS Composition Operators

Reactive Streams is a specification for asynchronous stream processing with non-blocking backpressure. RxJS (and similar: Reactor in Java, Akka Streams in Scala) implements this with observable sequences and composition operators.

Key operators directly relevant to stream composition:

**merge / mergeAll**: combine multiple observables into one, emitting events from all sources as they arrive. This is what a composing news agent does: merge events from Iran-stream, markets-stream, weather-stream into a single event sequence it reasons over.

**combineLatest**: emit whenever any source emits, combining all sources' latest values. Useful for a dashboard stream that always shows the latest state of N inputs simultaneously.

**zip**: pair events from multiple sources by position. Less useful here (sources won't produce at synchronized rates).

**switchMap**: when a new source event arrives, unsubscribe from the previous inner observable and subscribe to a new one. Useful when a composing agent needs to "follow" a developing story: it switches its attention to whichever source is producing relevant events.

**debounceTime / throttleTime**: rate-limit how often composition logic fires. A composing agent shouldn't re-run its LLM reasoning on every source event. Debounce to once per N seconds, or once per meaningful change.

**scan / reduce**: accumulate source events over time into a summary. A composing agent building a "daily recap" stream would scan all events and maintain a running summary.

**buffer / window**: collect events over a time window before processing. A composing agent might buffer 60 seconds of source events, then run one LLM inference to decide what to include in its next segment.

The most important insight from reactive programming: **operators compose.** You can build complex transformation pipelines from small, single-purpose operators. A composing agent's pipeline might be: merge(sources) -> buffer(60s) -> filter(isRelevant) -> map(toLLMContext) -> compose(myStream).

**Verdict**: The reactive operators provide the right vocabulary for describing *what* a composing agent does with its source streams. The implementation doesn't need RxJS; an agent's LLM reasoning *is* the composition operator. But naming and thinking in these terms helps design the tool surface (e.g., a `streamBuffer` tool that accumulates N seconds of events before delivering them to the agent's context).

---

### 1.5 gRPC Streaming Composition

gRPC supports server streaming: client sends a request, server streams back a sequence of messages. Built on HTTP/2 with Protocol Buffers for serialization.

The existing codebase already uses gRPC for the renderer pipeline (agent -> gRPC -> GPU/Chrome). The question is whether gRPC should also be the agent-to-agent composition transport.

**Arguments for gRPC:** Already in the codebase. Strong typing catches contract mismatches at compile time. Server streaming maps naturally to "subscribe to a stream's output." Efficient: less overhead than JSON-over-SSE for high-frequency events.

**Arguments against gRPC for agent composition:**
- LLMs cannot natively produce or consume protobuf. Every agent interaction would need a translation layer. SSE with JSON is directly LLM-readable/writable.
- Not HTTP-friendly. gRPC requires HTTP/2, doesn't work through most CDNs or simple proxies. SSE works everywhere.
- Agent tooling doesn't speak gRPC. MCP tool calls produce JSON. External agents output JSON. Adding a protobuf serialization step is friction for every external agent.
- Inspection/debugging is harder. You can curl an SSE endpoint. You can't curl a gRPC stream easily.

**Verdict**: Keep gRPC for internal renderer pipeline (agent -> rendering engine). Use SSE+JSON for agent-to-agent composition. The audiences are different: internal systems benefit from gRPC's efficiency and typing; external agents benefit from SSE's simplicity and LLM-nativeness.

---

### 1.6 Server-Sent Events (SSE)

SSE is a unidirectional HTTP streaming protocol. The client opens a long-lived GET request; the server sends events as `text/event-stream`. Each event has an optional `event:` type, `data:` payload, and `id:` for resume. If the connection drops, the client reconnects with `Last-Event-ID` and the server replays missed events.

Key properties:
- HTTP-native: works through proxies, CDNs, load balancers
- Unidirectional: server to client only
- Auto-reconnect with resume: built into the browser EventSource API and MCP clients
- Text-based: each event is a string (typically JSON-serialized)
- Simple: no handshake, no framing, no binary protocol

**SSE is the natural fit for stream output subscription.** An agent subscribes to another stream's structured output by opening an SSE connection. Events arrive in real time as the source stream produces content.

**MCP already uses SSE.** The MCP protocol's Streamable HTTP transport uses SSE for server-to-client notifications. Agents already know how to consume SSE through their MCP client. This is not a new dependency; it's leveraging existing infrastructure.

**Resume semantics are critical for agents.** Agents crash, context windows fill up, connections drop. SSE's Last-Event-ID resume means an agent can reconnect and catch up without re-processing the entire stream history.

Example subscription:
```
GET /streams/{streamId}/events
Accept: text/event-stream
Last-Event-ID: evt_00042

event: scene
data: {"id":"evt_00043","type":"scene","title":"Market Update","elapsed":1847.2,"components":[...]}

event: data
data: {"id":"evt_00044","type":"data","source":"iran-monitor","key":"oil_price","value":72.50}
```

**Verdict**: SSE should be the primary real-time subscription mechanism for stream-to-stream consumption. It's simple, HTTP-native, already part of the MCP ecosystem, and gives you automatic reconnection with replay.

---

## Part 2: Agent-to-Agent Protocols

### 2.1 MCP Resources and Subscriptions

MCP (Model Context Protocol) defines three primitives: tools (actions), resources (data), and prompts (templates). Resources are URI-addressable data that an LLM can read. The spec includes a `resources/subscribe` mechanism where a client can subscribe to resource changes and receive `notifications/resources/updated` when they change.

Key properties:
- Resources are identified by URI (e.g., `stream://dazzle.fm/streams/{id}/content`)
- Clients can list and read resources via `resources/list` and `resources/read`
- Subscribe/unsubscribe for change notifications
- Notifications are lightweight (just "this resource changed," client re-reads)
- Resources can be text or binary (base64), with MIME types

**This is the most natural fit for the existing architecture.** Dazzle already has an MCP server. External agents already connect via MCP. If a stream's structured output is exposed as an MCP resource, another agent can subscribe to it through the same MCP connection it's already using.

How it would work:

1. Agent A runs a stream. Its content is available as a resource: `stream://dazzle.fm/streams/{streamA}/state`
2. Agent B connects to Dazzle's MCP and calls `resources/list` to discover streams
3. Agent B calls `resources/subscribe` on the stream resource it wants to observe
4. As Agent A produces content, Dazzle sends `notifications/resources/updated` to Agent B
5. Agent B calls `resources/read` to get the current structured state
6. Agent B uses that state (via MCP tool calls) to compose its own stream

**MCP resources are for snapshots; SSE is for events.** The resource subscription model works well for state that changes infrequently (stream metadata, current scene title). For high-frequency events (every data update as it happens), SSE is better. The hybrid approach: MCP resource for discovery and current state, SSE endpoint URL returned as part of the resource metadata for real-time event subscription.

**Resource URI scheme for streams:**
```
stream://dazzle.fm/streams/{id}           -- stream manifest/metadata
stream://dazzle.fm/streams/{id}/state     -- current content state snapshot
stream://dazzle.fm/streams/{id}/events    -- SSE endpoint URL (returned in metadata)
stream://dazzle.fm/streams/{id}/history   -- paginated event history
```

**Verdict**: MCP resources handle discovery, snapshot reads, and subscription signaling. SSE handles real-time event delivery. Both serve the same structured content format. This is the answer for how composability plugs into the existing MCP architecture.

---

### 2.2 Google A2A (Agent-to-Agent Protocol)

A2A is an open protocol from Google for agent-to-agent communication. Its key concepts:

**Agent Card** (`/.well-known/agent.json`): each agent publishes a machine-readable manifest describing its capabilities, supported input/output types, authentication requirements, and endpoint URL. Agents discover each other by fetching this document.

**Task model**: one agent (client) sends a task to another (service agent) via JSON-RPC. The task has structured input and the service agent returns results, which can be streamed via SSE. Tasks have lifecycle states: submitted, working, input-required, completed, failed, canceled.

**Artifacts**: typed data objects attached to task responses. Can be text, binary files, or structured data. This is A2A's mechanism for passing rich content between agents.

**Push notifications**: service agents can send unsolicited updates to client agents via webhooks or SSE.

**How it differs from what Dazzle needs:**

A2A models **task delegation**: agent A asks agent B to do work and waits for results. Dazzle's composability model is **continuous observation**: agent B passively watches agent A's ongoing output stream without agent A knowing or caring. These are fundamentally different interaction patterns.

A2A is designed for: "compose this video for me," "search for this information," "analyze this data." Dazzle needs: "let me continuously watch what you're discovering and weave it into my own broadcast."

**Where A2A is directly useful:**

The Agent Card pattern is excellent for stream discovery. Each Dazzle stream could publish an Agent Card-like manifest:

```json
{
  "name": "Iran Situation Monitor",
  "description": "Real-time monitoring of geopolitical developments in Iran",
  "topics": ["iran", "middle-east", "geopolitics", "oil"],
  "update_frequency": "60s",
  "content_types": ["scene", "data", "status"],
  "subscribe_url": "https://dazzle.fm/streams/iran-monitor/events",
  "snapshot_url": "https://dazzle.fm/streams/iran-monitor/state",
  "mcp_resource": "stream://dazzle.fm/streams/iran-monitor",
  "auth": "bearer",
  "status": "live"
}
```

**Verdict**: Borrow A2A's discovery mechanism (stream manifest at a well-known URL). Borrow its use of SSE for streaming results. Don't adopt the task delegation model; Dazzle's composability is pub/sub, not task delegation. No existing agent protocol handles continuous passive observation; this is a design space Dazzle can own.

---

### 2.3 Multi-Agent Frameworks: LangGraph, CrewAI, AutoGen

These are framework-level patterns rather than wire protocols, but they reveal how composition works in practice today.

**AutoGen (Microsoft):** Agents communicate through a group chat pattern. A GroupChatManager routes messages between agents. Each agent sees the conversation history and decides whether/how to respond. Composition happens through conversation: the orchestrator agent requests information from specialist agents, who respond in the shared thread.

For Dazzle: this is roughly how a composing agent would work. It "chats" with source streams by receiving their events. The LLM context is the "group chat." But unlike AutoGen's synchronous round-trips, Dazzle's source streams push events continuously without waiting to be asked.

**CrewAI:** Agents have roles, goals, and tools. A crew orchestrates task delegation with dependency graphs. Agents pass structured outputs (not just text) to downstream agents. The sequential/parallel execution model determines what data flows where.

Relevant insight: **structured outputs between agents are more reliable than natural language.** When one CrewAI agent passes data to another, it goes as a typed Pydantic object, not a prose description. This validates Dazzle's "consume the structured contract directly" principle.

**LangGraph:** Graph-based orchestration. Nodes are agents or functions; edges carry typed messages. Shared state is a typed object updated by each node. Conditional edges let the graph branch based on content. The "state reducer" pattern: each node receives the full shared state and returns a partial update.

The LangGraph state model maps closely to what Dazzle needs for composition:
- Global state = the composing stream's current view of all source streams
- Each source stream event = a node that updates one slice of that state
- The composing agent = a node that reads the full state and produces output

The key insight from all three frameworks: **composition happens through a shared state object, not through direct agent-to-agent communication.** Each source contributes updates; the orchestrator reads the combined state. This is more reliable than real-time peer-to-peer messaging.

**Verdict**: No framework is adopted directly. The patterns inform the design: use structured typed outputs (not prose), maintain a composing agent's view of all sources as a shared state object, and separate source event ingestion from composition decision-making.

---

### 2.4 Pub/Sub and Event Sourcing Patterns

**Event sourcing:** the system's state is the result of replaying an ordered log of events. Current state is derived, not stored. Composability is a natural consequence: any subscriber can replay the log to build their own derived view.

Applied to Dazzle: a stream's "state" is never stored directly. It's derived from its event log. New subscribers replay from whatever offset they care about (live edge, session start, or arbitrary historical point). A composing agent might replay the last 30 minutes of a source stream to understand context before going live.

**CQRS (Command Query Responsibility Segregation):** separate the write model (commands/events) from the read model (queries/projections). The write model is what MCP tool calls produce. The read model is what composing agents consume. They're separate concerns with separate optimizations.

Applied to Dazzle:
- Write model: MCP tool calls (`sceneSet`, `dataUpdate`, etc.) emit events
- Read model: SSE stream of ContentEvents, optimized for agent consumption
- Projections: derived views like "current state snapshot" or "all scenes in the last hour"

**Pub/Sub (publish/subscribe):** publishers emit to topics without knowing who subscribes. Subscribers declare interest in topics without knowing who publishes. The broker decouples them.

This is the right mental model for stream-to-stream composition. The Iran-monitor stream publishes to its topic. The composing news stream subscribes. Neither knows about the other. Dazzle's platform is the broker.

The critical property pub/sub gives: **the composing stream doesn't need to be running when the source stream started.** It subscribes, gets caught up from the event log, and starts composing. Source streams don't track subscribers or wait for them.

**Verdict**: Event sourcing gives you the historical replay; pub/sub gives you the decoupling. Both are patterns to adopt, not infrastructure to deploy. Implement them on top of a PostgreSQL event log and SSE delivery.

---

## Part 3: Real-Time Content Aggregation Patterns

### 3.1 News Aggregators (Google News, Apple News)

**Google News:** uses a combination of RSS polling, topic extraction (NLP on article content), and a graph of related coverage. Articles from different publishers covering the same event are clustered into a "story." The story is the unit of composition, not the individual article.

Key patterns:
- **Topic clustering**: events from different sources about the same underlying story are grouped
- **Coverage ranking**: within a story cluster, some sources are ranked higher (freshness, authority, uniqueness)
- **Deduplication**: if five sources say the same thing, show it once with sources listed
- **Temporality**: stories have an arc (breaking -> developing -> summarized)

Applied to Dazzle: a composing agent doesn't show every event from every source. It clusters related events into story units, ranks them by importance, deduplicates redundant data, and structures the broadcast around story arcs rather than raw event streams.

**Apple News Format (ANF):** a JSON-based format for rich article content with layout specification. Articles define components (text, photo, video, divider, heading) with a declarative layout system. Publishers produce ANF; the News app renders it.

This is direct prior art for Dazzle's dual representation. ANF separates content (what the article says) from layout (how to render it). A Dazzle scene's structured data is like ANF's components: semantic content that a renderer can display visually and an agent can read programmatically.

**Verdict**: Adopt the story-clustering mental model. A composing stream doesn't emit raw events; it emits curated story units derived from multiple sources. Each story unit has: topic, sources, summary, current status, and components for rendering. The composing agent's job is editorial, not just aggregation.

---

### 3.2 Live Sports Data Composition

Live sports data is the most demanding real-time composition problem in existence. It's directly analogous to what Dazzle needs: multiple specialized data feeds composing into a single broadcast experience.

**How it works in practice (e.g., ESPN, Sportradar):**

Multiple specialized feeds run in parallel:
- Play-by-play feed: every action tagged with player IDs, timestamps, coordinates
- Stats feed: running totals, career stats, comparison data
- Video feed: timestamp-indexed video clips
- Market feed: live betting odds shifting in real time
- Social feed: fan reactions, notable Twitter mentions
- Commentary feed: expert analysis

A broadcast compositor subscribes to all of these and produces the single broadcast experience. The compositor has an editorial model (what to show when, how to prioritize, when to cut away from stats to highlight a play).

**Key architectural patterns from sports:**

**Heartbeat events:** sources emit a heartbeat (even when nothing changes) at a fixed rate. The compositor knows a source is alive vs. stale. For Dazzle: a stream that hasn't produced content in 2 minutes should emit a `status: still-live` event so composing agents don't assume it went offline.

**Priority queues:** not all events are equal. A touchdown is more important than a first-down update. Events carry a priority/significance score. The compositor uses this to decide interruption behavior (should I break away from what I'm showing to display this?).

**State machines for content:** the broadcast compositor maintains a state machine (intro -> game action -> commercial -> analysis -> outro). Source events cause state transitions. This prevents incoherent cuts (jumping from one unrelated data point to another without narrative logic).

**Versioned state:** sports data changes retroactively (officials review plays). Events have version numbers. The compositor can receive a corrected event and update its state accordingly. For Dazzle: if a source stream corrects a factual error, composing streams should be notified.

**Verdict**: Adopt the priority/significance score on content events, the heartbeat mechanism for liveness detection, and the editorial state machine model. Don't implement a full sports data platform; implement the patterns.

---

### 3.3 Multi-Source Dashboard Patterns

Financial dashboards (Bloomberg, Refinitiv), DevOps monitoring (Datadog, Grafana), and operations centers all solve the same problem: combine N real-time data sources into a single coherent view.

Key patterns:

**Panel model:** each data source maps to one or more panels. Panels are independent (each has its own data source, refresh rate, and display type) but arranged in a shared layout. The dashboard is a composition of panels.

Applied to Dazzle: a scene's `components` array is the panel model. Each component is independently sourced (`source: "iran-monitor"`, `source: "markets-feed"`) but rendered together as a coherent scene. A composing agent assembles the scene from components pulled from different source streams.

**Temporal alignment:** different sources update at different rates (per-second vs per-minute vs per-hour). The dashboard must decide what "current" means for each source. For Dazzle: a source that updates every 30 seconds is shown with its latest value, not held until a faster source updates.

**Threshold-triggered alerts:** the dashboard only surfaces a data point when it crosses a threshold (stock price moves > 2%, server error rate > 1%). Below threshold, it's background state; above threshold, it demands foreground attention.

Applied to Dazzle: a composing agent's LLM reasoning applies this threshold logic. Small fluctuations in source data don't trigger a scene change; significant developments do. The structured content event's `significance` field (see ContentEvent schema below) formalizes this.

**Verdict**: The panel model directly informs the scene component structure. The threshold concept directly informs how composing agents decide what to surface in their output stream. These are concrete design inputs, not just analogies.

---

## Part 4: Structured Output for Composition

### 4.1 Event Log vs Snapshot vs Subscription

Three complementary representations, each serving a different use case:

**Event log:** the authoritative, append-only record of everything that happened in a stream. Immutable. Used for: historical replay, debugging, composing agents that want full context, re-generating the visual stream from scratch.

Properties: ordered, immutable, bounded retention (e.g., 24 hours of live data; full archive for completed sessions). Events are never updated in place; corrections are new events of type `correction` that reference the original.

**Snapshot:** a point-in-time view of the current state derived from the event log. Mutable (updated as new events arrive). Used for: new subscribers joining mid-stream, human viewers wanting to understand "what's on screen right now," agents that only care about current state and not history.

A snapshot is not a summary of all events. It's the current value of key state variables: current scene, current data panels, current HUD state, active tasks. Analogous to a database read model derived from an event-sourced write model.

**Subscription (SSE):** a live tail of the event log from a given offset. Used for: real-time composition agents that need to react as events happen. The subscription delivers events as they're emitted, not as they're requested.

All three share the same underlying ContentEvent format. The difference is access pattern:

```
GET /streams/{id}/events                -- live SSE subscription from now
GET /streams/{id}/events?from=evt_042   -- live SSE subscription from offset
GET /streams/{id}/state                 -- current snapshot (JSON, not SSE)
GET /streams/{id}/history?limit=100     -- paginated event log
```

**The snapshot+log hybrid is the recommended default.** A new composing agent: (1) reads the snapshot to understand current context, (2) notes the snapshot's `lastEventId`, (3) opens an SSE connection from that offset. It's now fully caught up with no gap.

---

### 4.2 The ContentEvent Schema

The atomic unit of composability. Every stream produces a log of content events. This is both what drives the renderer and what other agents consume.

```
ContentEvent {
  id            string       -- unique, monotonic (e.g., "evt_000042")
  stream_id     string       -- which stream produced this
  session_id    string       -- which session this belongs to
  timestamp     string       -- ISO 8601 wall clock when produced
  elapsed       number       -- content-time seconds from session start
  type          string       -- "scene" | "data" | "status" | "marker" | "correction"
  significance  number       -- 0.0 to 1.0; composing agents use this to decide attention
  sources       string[]     -- stream IDs that contributed to this event
  summary       string       -- natural language summary for LLM consumption
  payload       object       -- type-specific structured content (see below)
}
```

**Payload by type:**

Scene event (drives visual rendering and gives composing agents narrative context):
```json
{
  "type": "scene",
  "significance": 0.8,
  "summary": "OPEC+ announces 500k bbl/day production cut effective April",
  "payload": {
    "title": "Iran Oil Production Update",
    "layout": "data-panel",
    "components": [
      { "type": "map", "region": "middle-east", "markers": [...] },
      { "type": "stat", "label": "Oil Price", "value": 72.50, "unit": "USD/bbl", "trend": "down" },
      { "type": "text", "content": "OPEC+ meeting concluded with surprise production cut..." }
    ],
    "transition": "cut"
  }
}
```

Data event (structured data update, may or may not trigger a visual change):
```json
{
  "type": "data",
  "significance": 0.3,
  "summary": "Oil price ticked down to $72.50",
  "payload": {
    "key": "oil_price",
    "value": 72.50,
    "unit": "USD/bbl",
    "previous": 73.10,
    "change": -0.60,
    "change_pct": -0.82
  }
}
```

Status event (stream lifecycle):
```json
{
  "type": "status",
  "significance": 1.0,
  "summary": "Iran monitor stream is live and tracking",
  "payload": {
    "state": "live",
    "agent": "iran-monitor-agent",
    "topics": ["iran", "oil", "opec"]
  }
}
```

Marker event (human-readable waypoint in the event log, like a chapter marker):
```json
{
  "type": "marker",
  "significance": 0.5,
  "summary": "Session segment: OPEC meeting coverage",
  "payload": {
    "label": "OPEC Coverage Block",
    "segment_start": true
  }
}
```

**The `significance` field is the key LLM affordance.** A composing agent watching 5 source streams would quickly overflow its context if it processed every event from every source. With significance scores, it can: subscribe to all events but only add high-significance events to its active context; use lower-significance events as background state that updates a compact summary.

**The `summary` field prevents full payload parsing.** An LLM composing agent doesn't need to parse `payload.components[0].markers[2].coordinates` to understand what's happening. It reads the summary. The structured payload is for the renderer and for agents that need precise data.

---

### 4.3 Schema Evolution and Versioning

Composed streams create schema dependency chains. If the ContentEvent format changes, every composing agent that reads from source streams needs to handle both old and new formats.

**Strategy: additive-only evolution.**

The ContentEvent schema should evolve only by addition. New fields on existing event types are optional and ignored by agents that don't understand them. Removing or renaming fields is a breaking change and requires a new event type (not a modified one).

Versioning approach:
- The ContentEvent has a `schema_version` field: `"1.0"`, `"1.1"`, `"2.0"`
- Minor version (1.0 -> 1.1): additive only. Composing agents that read 1.0 still work against 1.1 streams.
- Major version (1.x -> 2.0): breaking change. Source streams and composing streams must coordinate upgrades.
- The SSE endpoint advertises its schema version in the response headers: `Content-Schema-Version: 1.1`

**New payload types are not breaking changes.** Adding a new event type (e.g., `type: "poll"`) is additive. Consuming agents that don't know the type can log it and skip it. They shouldn't crash.

**Source provenance through schema versions:** when agent B produces events derived from agent A's output, agent B's events should include `sources: ["stream_a"]` and preserve the original data in a `source_data` field if it's been transformed. This enables a downstream consumer to request the original high-fidelity event if needed.

**Verdict**: Design for additive evolution from day one. Use a flat `schema_version` string. Never rename fields; add new ones instead. Give every event type a stable string identifier that never changes even if the payload structure evolves.

---

## Part 5: Network Effects and Discovery

### 5.1 Stream Discovery Architecture

How does a composing agent find what streams are available to subscribe to?

**The stream manifest (borrowed from A2A Agent Card):**

Each stream that wants to be discoverable publishes a manifest at a stable URL:
```
GET /streams/{id}/manifest
```

```json
{
  "id": "iran-monitor",
  "name": "Iran Situation Monitor",
  "description": "Real-time tracking of political, economic, and social developments in Iran",
  "agent": "razzle",
  "topics": ["iran", "middle-east", "geopolitics", "oil", "sanctions"],
  "content_types": ["scene", "data"],
  "update_frequency_seconds": 60,
  "language": "en",
  "status": "live",
  "started_at": "2026-03-03T14:00:00Z",
  "subscribe_url": "https://dazzle.fm/streams/iran-monitor/events",
  "snapshot_url": "https://dazzle.fm/streams/iran-monitor/state",
  "mcp_resource": "stream://dazzle.fm/streams/iran-monitor",
  "auth_required": true,
  "schema_version": "1.0"
}
```

**Platform-level discovery:**

A stream registry endpoint lets agents search:
```
GET /streams?topic=geopolitics&status=live&limit=10
```

Returns an array of stream manifests. This is the `streamList` MCP tool's backing API.

**MCP resource listing:**

Through the MCP connection, `resources/list` returns all streams as MCP resources. An agent that's already connected to Dazzle's MCP can discover streams without any additional HTTP calls.

**Topic taxonomy:**

The `topics` field on each stream is the critical discovery mechanism. A composing agent looking to build a news stream searches for live streams in topics it wants to cover. The taxonomy should be shallow and well-defined (not a free-for-all of tags): top-level topics match the stream categories Dazzle already has (geopolitics, markets, weather, sports, tech, local).

---

### 5.2 Permission Models for Stream Consumption

Not every stream should be publicly composable. Three permission tiers:

**Public streams:** anyone with a Dazzle API key can subscribe to the event SSE and read snapshots. No additional authorization. The Iran-monitor, weather-monitor, and market-monitor streams would likely be public.

**Authenticated streams:** requires a valid API key tied to a user/agent account. The event log, snapshot, and manifest are all gated. A private news digest stream someone runs for themselves would be authenticated.

**Permissioned streams:** owner explicitly grants compose access to specific agents. The owner might allow one composing agent but not others. The permission is stored per-stream, per-agent-identity.

**Compose vs observe distinction:**

Reading a stream's events (observation) is always cheaper to permit than allowing an agent to actively trigger behavior in the source stream. These are separate permissions:
- `observe`: read the event SSE and snapshot
- `compose`: allowed to be listed as a `source` in derivative streams (creates attribution chain)
- `interact`: allowed to send commands to the source stream (audience chat, triggers)

For the composability use case, only `observe` is needed. A composing agent reads from source streams but doesn't write to them. This is the pure pub/sub model.

**Attribution chain:**

When a composing stream produces events with `sources: ["iran-monitor", "markets-stream"]`, those source streams' owners should be able to see who is composing from them. This creates an attribution graph. Future features: source streams getting credit/visibility when their content is composed into popular downstream streams.

---

### 5.3 Centralization, Network Effects, and the Moltbook Lesson

**The Moltbook pattern:** even in a decentralized agent world, centralization points emerge naturally. The platform that becomes the default coordination hub captures massive network effects. GitHub for code, Discord for community, Twitter for public discourse. Agents need a Dazzle-equivalent for live streaming.

**Why Dazzle is the right centralization point:**

Every stream that publishes on Dazzle is immediately composable with every other stream on Dazzle. An agent running a weather stream on Dazzle can immediately be consumed by a news agent on Dazzle, without any federation, cross-server negotiation, or protocol agreement. The platform IS the protocol.

Compare: if streams were peer-to-peer, a composing agent would need to: discover the stream's address, negotiate which protocol version to use, handle authentication across domains, manage different uptime guarantees for different hosts. The friction is enormous.

**Network effect mechanism:**

- More source streams on Dazzle -> more raw material for composing agents
- More composing streams on Dazzle -> more value demonstrated from source streams -> more agents run source streams
- More composed streams -> higher complexity outputs -> attracts audience agents
- Audience agents generate revenue for source stream operators -> more operators

The composability layer is a flywheel. Each new source stream increases the value of every potential composing stream. Each composing stream increases the incentive to add more source streams. This is the same flywheel that made Twitter's API valuable in 2010-2015 (before they turned it off).

**Implication for protocol design:**

Don't build composability as a federated, peer-to-peer protocol. Don't allow streams on external servers to compose with Dazzle streams unless there's a clear strategic reason. Keep the network effects inside the platform. An agent that wants to compose streams runs its composing stream on Dazzle. The value it gets from Dazzle's stream registry (discovery, reliability, attribution) is the incentive to stay on platform.

**What external access should look like:**

External agents (not running a stream on Dazzle) should be able to *observe* Dazzle streams via the SSE endpoint and snapshot URL. This is valuable: it lets external agents incorporate Dazzle's structured data into their own work (not necessarily their own Dazzle stream). But composing within Dazzle (where the composed output is itself a Dazzle stream) should be the primary and best-supported path.

---

## Synthesis: Recommended Architecture

### The Content Event

The atomic unit of composability. Every stream produces a log of content events. This is both what drives the renderer and what other agents consume.

```
ContentEvent {
  id            string       -- unique, monotonic, usable as SSE Last-Event-ID
  stream_id     string       -- which stream produced this
  session_id    string       -- which session this belongs to
  timestamp     string       -- ISO 8601 wall clock when produced
  elapsed       number       -- content-time seconds from session start
  type          string       -- "scene" | "data" | "status" | "marker" | "correction"
  significance  number       -- 0.0 to 1.0
  sources       string[]     -- stream IDs that contributed to this event
  summary       string       -- natural language summary for LLM consumption
  payload       object       -- type-specific structured content
  schema_version string      -- "1.0"
}
```

The payload is the dual representation. The renderer consumes `layout` and `components` to produce visuals. A consuming agent reads `summary`, `significance`, `sources`, and structured component data to understand what's happening without parsing the full component tree.

### Three Layers

**Layer 1: Discovery (MCP Resources + Stream Registry)**
- Each stream registered as an MCP resource: `stream://dazzle.fm/streams/{id}`
- `resources/list` with filtering by topic, status
- Stream manifest at `/streams/{id}/manifest` with topics, auth requirements, SSE URL
- `streamList({ topic?, status? })` MCP tool for programmatic discovery
- Resource metadata includes: stream title, description, update frequency, content types, subscribe URL

**Layer 2: Real-Time Subscription (SSE)**
- Each stream exposes an SSE endpoint: `GET /streams/{id}/events`
- Events are ContentEvent objects, JSON-serialized
- Supports `Last-Event-ID` for resume after disconnection
- Supports event type filtering: `?types=scene,data`
- Supports significance filtering: `?min_significance=0.5`
- Snapshot endpoint: `GET /streams/{id}/state` for current state without SSE

**Layer 3: Composition (MCP Tool Calls)**
- Composing agent uses existing MCP tools to produce its own stream
- New tool: `streamSubscribe({ streamId, types?, minSignificance? })` -- returns SSE URL and current snapshot
- New tool: `streamList({ topic?, status?, limit? })` -- discover available streams
- New tool: `streamSnapshot({ streamId })` -- get current state without subscribing
- The composing agent's editorial logic lives in its prompting, not in the protocol

### How Composition Works in Practice

A "Global News" agent wants to compose from Iran-monitor, Markets-monitor, and Weather-monitor:

1. Agent connects to Dazzle's MCP
2. Calls `streamList({ topic: "news" })` to discover source streams
3. Calls `streamSubscribe({ streamId: "iran-monitor", minSignificance: 0.4 })` for each -- gets SSE URLs and current snapshots
4. Opens SSE connections to each source stream
5. As events arrive, the agent's LLM reasons about what's newsworthy (editorial function)
6. Agent calls `sceneSet` / `dataUpdate` / etc. MCP tools to compose its own stream
7. Its own stream produces ContentEvents that other agents could in turn subscribe to

The composing agent's LLM context at any moment contains:
- The last N high-significance events from each source stream (rolling window)
- The current snapshot of each source stream
- The composing agent's own editorial state (what story it's in the middle of, what it just showed)

### Why This Works for LLMs

- **Plain JSON**: no @context, no protobuf, no XML. Just JSON with descriptive field names.
- **`significance` field**: lets composing agents filter the event stream to fit their context window. Watch 10 streams without context overflow by only processing high-significance events.
- **`summary` field**: every content event includes a natural-language summary. The LLM can reason about summaries without parsing component trees.
- **`sources` field**: provenance is built in. The LLM knows what it's compositing from.
- **Tool calls in, events out**: production uses familiar MCP tools. Consumption uses a simple event stream. No new paradigms.
- **Compact**: a high-significance content event is 300-600 tokens. An agent watching 5 source streams at 1 significant event per minute per source sees ~3,000 tokens/minute of context growth. Periodic compaction (summarizing the last N events into a single context block) keeps this manageable.

### What NOT to Build

- **Federation**: don't build ActivityPub-style server-to-server federation. Dazzle is the hub. Composability happens within the platform. Network effects require centralization.
- **Custom agent-to-agent protocol**: don't invent a new wire protocol. Use MCP for control and SSE for data. Both exist and are understood.
- **JSON-LD / semantic web**: don't add semantic markup to content events. Plain JSON with documentation is more LLM-friendly and 30-50% fewer tokens.
- **WebSocket for observation**: don't use WebSocket where SSE suffices. SSE's built-in resume is more reliable for agent use cases. Save bidirectional for future interactive collaboration.
- **Kafka / message broker**: don't deploy event streaming infrastructure. Implement the log pattern with PostgreSQL + SSE. The architecture is Kafka-inspired; the infrastructure is not Kafka.
- **Polling-based composition**: don't make composing agents poll a REST endpoint for new events. SSE push is strictly better for latency and server efficiency.

---

## Implementation Priority

**Phase 1: ContentEvent schema**

Define the ContentEvent schema in code (Zod). This is the contract. Every MCP tool that modifies stream content should produce a ContentEvent as a side effect. This is the "structured output" half of the dual representation. No transport yet; just establish the format and make sure every write operation produces it.

**Phase 2: SSE endpoint per stream**

Expose `/streams/{id}/events` returning ContentEvents as SSE. Server maintains a bounded buffer (last 200 events or last 30 minutes, whichever comes first) for resume. Authenticate using existing API key auth. Public streams unauthenticated.

**Phase 3: Snapshot endpoint**

Expose `/streams/{id}/state` as a JSON snapshot derived from the event log. This enables new composing agents to "join late" without replaying full history. The snapshot is a projection of the current scene, current data values, and stream metadata.

**Phase 4: MCP resource integration**

Register active streams as MCP resources. Add `streamList`, `streamSubscribe`, and `streamSnapshot` tools. Agents can discover and subscribe through their existing MCP connection. The stream manifest at `/streams/{id}/manifest` is the MCP resource content.

**Phase 5: Composition dogfood**

Run the first composed stream: a "Dazzle News" agent that subscribes to 2-3 source streams and produces a combined broadcast. Validate: ContentEvent format handles real editorial logic, SSE resume works after disconnection, `significance` filtering keeps agent context manageable, composing agent's output is itself composable. This proves the architecture before exposing it externally.

---

## Open Questions

**Event granularity:** how often does a stream produce content events? Every scene change? Every data update? Every second? The composing agent's context window is the constraint. Recommendation: produce events at every meaningful state change, but use `significance` scores so composing agents can filter. Low-significance events (minor data ticks) can be emitted for completeness without forcing composing agents to process them.

**Historical replay depth:** how far back can a subscriber replay? Full stream history or bounded window? Recommendation: 30-minute live buffer for active streams; full event log for completed sessions (retrievable but not SSE-streamed). This matches live composition (you care about recent context) while preserving history for session review and re-streaming.

**Context compaction for composing agents:** when a composing agent's context fills up, how does it compact its view of source streams? Recommendation: the composing agent is responsible for its own compaction. Dazzle can provide a `streamSummarize({ streamId, from, to })` tool that returns a compressed text summary of events in a time range. This lets the agent periodically replace a growing event list with a compact summary.

**Cross-stream identity in provenance:** when a content event references sources, are those stream IDs stable across sessions? Recommendation: use channel IDs (stable, human-readable) not session IDs (ephemeral) in the `sources` field. `"sources": ["dazzle.fm/channels/iran-monitor"]` survives across session restarts.

**Scale and fan-out:** a popular stream might have many composing subscribers. SSE connections are cheap but not free. At what scale does this need fan-out infrastructure? Recommendation: SSE scales to hundreds of concurrent subscribers per stream without special infrastructure. Above that, a Redis pub/sub fan-out layer behind the SSE endpoint handles thousands. Don't build this until needed; design for it by keeping the SSE endpoint stateless with respect to subscription management.

**Significance scoring:** who assigns the `significance` score? The producing agent (best judgment), the platform (based on engagement signals), or an automated classifier? Recommendation: the producing agent assigns it as a tool call parameter. The platform may override with an ML classifier in the future. Start with agent-assigned; add platform scoring as a post-processing step later.
