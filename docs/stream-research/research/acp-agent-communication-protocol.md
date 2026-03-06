# ACP: Agent Communication Protocol — Research

Research into IBM's Agent Communication Protocol (ACP), its current status post-merger with A2A, and its relevance to Dazzle's agentic broadcasting platform.

---

## 1. What Is ACP? Who Created It? When Was It Released?

ACP (Agent Communication Protocol) is an open protocol for communication between AI agents, applications, and humans. Its stated goal is to solve the fragmentation problem in AI agent development: organizations build agents across different frameworks, teams, and infrastructures in isolation, which prevents effective agent-to-agent collaboration.

**Origin**: IBM Research launched ACP in March 2025 as the communication backbone for their BeeAI Platform. The project was donated to the Linux Foundation AI & Data foundation shortly after launch.

**Repository**: `github.com/i-am-bee/acp` — Apache 2.0 license, 28 contributors, 952 stars at time of archival.

**Final release**: v1.0.3, August 21, 2025.

**Current status**: The repository was archived and made read-only on August 27, 2025. The ACP team announced on August 29, 2025 that ACP is merging into Google's A2A protocol under Linux Foundation governance. ACP as a standalone protocol is effectively superseded. The DeepLearning.AI course on ACP was replaced in February 2026 with an A2A course.

The short lifecycle (March–August 2025, about 6 months) means ACP never reached broad production adoption, but its ideas — REST-native agent messaging, multipart MIME messages, streaming via SSE, and the run/await lifecycle — are being carried forward into A2A.

---

## 2. How Does ACP Compare to MCP? What Problem Does It Solve That MCP Doesn't?

These protocols target different layers of the agent stack and are not direct competitors.

### Layer Model

```
User / Human
    |
Orchestrator Agent
    |  <-- ACP (agent-to-agent)
Specialized Agents
    |  <-- MCP (agent-to-tools/resources)
Tools, APIs, Files, Databases
```

### MCP (Model Context Protocol) — Anthropic, November 2024

MCP is a context enrichment protocol. It standardizes how a single LLM-based agent accesses external tools, resources, and prompts. The model is the client; tools are servers. Communication is JSON-RPC 2.0, typically over HTTP+SSE or stdio.

MCP answers: "How does my agent call a tool?"

Limitations for agent-to-agent use:
- Stateless tool invocations — no memory across calls beyond what the model holds
- No concept of long-running tasks with pause/resume
- Discovery is static (you configure tool servers at startup)
- No built-in multimodal message structure; tool inputs/outputs are typed JSON

### ACP — IBM Research, March 2025

ACP answers: "How do autonomous agents communicate with each other?" It treats agents as first-class peers, not tools. Key problems it solves that MCP does not:

1. **Persistent cross-agent memory**: ACP has sessions — conversation state that persists across multiple runs, shared across server instances via pluggable storage backends. MCP has no cross-request memory concept.

2. **Asynchronous long-running tasks**: ACP's run lifecycle (CREATED → IN_PROGRESS → AWAITING → COMPLETED) supports tasks that take minutes or hours. An agent can pause (`AWAITING`) and request human or external input, then resume. MCP tool calls are synchronous and short-lived.

3. **Token-by-token streaming**: ACP streams agent output via SSE as the agent generates it, using `MessagePartEvent` deltas. MCP can stream tool responses but it's not a core design concern.

4. **Multimodal messages**: ACP messages are MIME-typed multipart structures — an agent can return text, images, JSON, binary files, and audio in the same message. MCP tool outputs are typed JSON schemas.

5. **Dynamic discovery**: ACP agents advertise manifests (`AgentManifest`) at a registry endpoint. Clients discover agents at runtime. MCP servers are configured statically.

6. **Framework agnosticism**: ACP runs on top of REST/HTTP with no specialized libraries required. BeeAI, LangChain, CrewAI, and custom agents all speak the same wire format.

### Summary Table

| Aspect | MCP | ACP |
|---|---|---|
| Primary scope | Single agent ↔ tools | Agent ↔ agent |
| Transport | JSON-RPC 2.0 over HTTP/stdio | REST over HTTP |
| Message format | JSON-RPC method calls | Multipart MIME messages |
| Discovery | Static configuration | Registry-based (GET /agents) |
| State / memory | Stateless per call | Sessions across runs |
| Long-running tasks | No | Yes (await/resume) |
| Streaming | Limited | SSE, delta events |
| Multimodal | Structured JSON | Any MIME type |
| Governance | Anthropic | Linux Foundation (via A2A) |

---

## 3. Protocol Spec: Transport, Message Format, Discovery

ACP v1.0.3 is defined by an OpenAPI 3.x specification at `docs/spec/openapi.yaml` in the repository.

### Transport

Plain HTTP/HTTPS. No special framing, no persistent connections required (except for SSE streaming mode). REST semantics throughout.

### Core Endpoints

| Endpoint | Method | Purpose |
|---|---|---|
| `GET /ping` | GET | Health check for load balancers |
| `GET /agents` | GET | List all agents with pagination |
| `GET /agents/{name}` | GET | Retrieve a specific agent manifest |
| `POST /runs` | POST | Create and execute a run (sync, async, or stream) |
| `GET /runs/{run_id}` | GET | Poll run status |
| `POST /runs/{run_id}` | POST | Resume an AWAITING run |
| `GET /runs/{run_id}/events` | GET | SSE stream of run events |

### Agent Discovery

`GET /agents` returns an array of `AgentManifest` objects:

```json
{
  "agents": [
    {
      "name": "scene-analyzer",
      "description": "Analyzes video frames and emits structured scene data",
      "metadata": {
        "framework": "crewai",
        "supported_languages": ["en"]
      }
    }
  ]
}
```

Each manifest can also declare `input_content_types` and `output_content_types` as arrays of MIME types, telling consumers what the agent can accept and produce without needing to read documentation.

### Message Format

Every agent interaction is structured as a `Message` containing ordered `MessagePart` objects:

```json
{
  "role": "user",
  "parts": [
    {
      "content_type": "text/plain",
      "content": "Analyze the following frame"
    },
    {
      "content_type": "image/jpeg",
      "content": "<base64-encoded-jpeg>",
      "content_encoding": "base64",
      "name": "frame-00142"
    }
  ]
}
```

`MessagePart` fields:
- `content_type`: MIME type (default: `text/plain`)
- `content`: inline string data (mutually exclusive with `content_url`)
- `content_url`: URI to external content (mutually exclusive with `content`)
- `content_encoding`: `plain` or `base64`
- `name`: optional; when set, makes this part a named **Artifact** — a semantically addressable unit downstream agents can extract by name
- `metadata`: optional `CitationMetadata` or `TrajectoryMetadata`

### Artifacts

A `MessagePart` with a `name` field becomes an Artifact. Artifacts are named, typed content blobs within a message that downstream consumers can pull out by name rather than by position. For structured output pipelines, this is the core composability primitive: an agent names its outputs (`"scene-graph"`, `"transcript"`, `"overlay-commands"`), and consuming agents extract by name.

### Run Lifecycle

```
CREATED → IN_PROGRESS → AWAITING → IN_PROGRESS → COMPLETED
                                                → FAILED
                      → CANCELLING → CANCELLED
```

The `AWAITING` state is notable: an agent can pause mid-task and emit an `await_request` describing what input it needs (e.g., human approval, a file, data from another agent). The orchestrator resumes the run via `POST /runs/{run_id}` with the requested input.

### Run Creation

`POST /runs` with `mode: "sync"`, `"async"`, or `"stream"`:

```json
{
  "agent_name": "echo",
  "input": [
    {
      "role": "user",
      "parts": [
        {
          "content_type": "text/plain",
          "content": "Hello"
        }
      ]
    }
  ],
  "mode": "stream",
  "session_id": "optional-session-uuid"
}
```

### Sessions

Passing a `session_id` links a run to a persistent conversation context. The session stores message history server-side and makes it available as context to subsequent runs in the same session. Sessions work across distributed server instances when using a shared storage backend.

### Metadata Types

**CitationMetadata** — tracks information sources cited in a response:
```json
{
  "type": "citation",
  "url": "https://source.example.com/doc",
  "title": "Source Title",
  "start_index": 42,
  "end_index": 87
}
```

**TrajectoryMetadata** — captures reasoning steps and tool executions for debugging:
```json
{
  "type": "trajectory",
  "message": "Decided to use image classifier based on content type",
  "tool_name": "classify_image",
  "tool_input": {"url": "..."},
  "tool_output": {"label": "outdoor-scene", "confidence": 0.94}
}
```

---

## 4. Agent-to-Agent Communication

ACP treats agent-to-agent calls as standard HTTP requests using the same REST interface used by human clients. There is no special peer-to-peer channel — an orchestrating agent runs an ACP client, discovers peer agents via `GET /agents`, and invokes them via `POST /runs`.

### Composition Patterns

ACP's documentation explicitly describes four composition patterns:

**Prompt Chaining** — sequential: agent A's output becomes agent B's input, which feeds agent C:

```python
async with Client(base_url="http://localhost:8000") as client:
    # Step 1: generate
    run1 = await client.run_sync(
        agent="content-writer",
        input=[Message(parts=[MessagePart(content=topic)])]
    )
    # Step 2: edit — feed output as new input
    run2 = await client.run_sync(
        agent="content-editor",
        input=run1.output
    )
    # Step 3: translate
    run3 = await client.run_sync(
        agent="translator",
        input=run2.output
    )
```

**Routing** — a router agent selects which specialist to delegate to:

```python
# Router exposes specialists as tools, decides based on request content
router_run = await client.run_sync(
    agent="support-router",
    input=[Message(parts=[MessagePart(content=user_request)])]
)
```

**Parallelization** — concurrent fan-out via `asyncio.gather`:

```python
results = await asyncio.gather(
    client.run_sync(agent="fr-translator", input=messages),
    client.run_sync(agent="de-translator", input=messages),
    client.run_sync(agent="ja-translator", input=messages),
)
```

**Hierarchical** — a planner agent delegates subtasks to worker agents, aggregates, and synthesizes.

The key insight: because all agents speak the same wire format, an orchestrator agent can be built in BeeAI while workers are LangChain or CrewAI agents — the framework boundary is invisible at the protocol level.

### Cross-Framework Example (from IBM tutorial)

A four-agent pipeline built across two frameworks:

1. **Research Agent (crewAI, port 8000)** — given a URL, extracts themes
2. **SongWriter Agent (crewAI, port 8000)** — given themes, writes lyrics
3. **A&R Agent (BeeAI, port 9000)** — critiques lyrics for marketability
4. **Report Agent (crewAI, port 8000)** — formats everything as markdown

Each handoff is a standard ACP `run_sync` or `run_stream` call. The orchestrator is a Python script that knows nothing about which framework each agent uses.

---

## 5. Streaming and Real-Time Data

Streaming is a first-class concern in ACP, not an afterthought.

### Three Execution Modes

**Sync** — blocks until complete, returns full output. For fast agents.

**Async** — returns immediately with a `run_id`. Client polls `GET /runs/{run_id}` for status. For long-running tasks where the client doesn't need incremental updates.

**Stream** — SSE push of typed events as the agent generates output. For real-time display, pipeline feeding, or progress visualization.

### Streaming via curl

```bash
curl -N \
  -H "Accept: text/event-stream" \
  -H "Content-Type: application/json" \
  -X POST http://localhost:8000/runs \
  -d '{
    "agent_name": "scene-analyzer",
    "input": [{"role": "user", "parts": [{"content_type": "text/plain", "content": "Analyze stream"}]}],
    "mode": "stream"
  }'
```

### SSE Event Types

The event stream emits typed events:

| Event | When fired |
|---|---|
| `RunCreatedEvent` | Run accepted by server |
| `RunInProgressEvent` | Agent started processing |
| `MessageCreatedEvent` | Agent begins emitting a message |
| `MessagePartEvent` | Incremental content delta (the streaming token) |
| `MessageCompletedEvent` | Full message assembled |
| `RunAwaitingEvent` | Agent paused, needs external input |
| `RunCompletedEvent` | Run finished successfully |
| `RunFailedEvent` | Run ended with error |
| `ErrorEvent` | Protocol-level error |

### Streaming SDK Pattern

```python
async for event in client.run_stream(
    agent="scene-analyzer",
    input=[Message(parts=[MessagePart(content="Analyze current frame")])]
):
    match event:
        case MessagePartEvent(part=MessagePart(content=delta)):
            # incremental text token or partial JSON
            print(delta, end="", flush=True)
        case MessageCompletedEvent():
            # full assembled message available in event.message
            process_complete_message(event.message)
        case RunCompletedEvent():
            break
```

### Delta Streaming

ACP uses delta-style streaming: `MessagePartEvent` carries the incremental update, not the full accumulated state. This is appropriate for token-by-token LLM output and for streaming structured JSON that builds up incrementally. Consumers accumulate deltas themselves.

### Streaming Structured Output

An agent can stream structured data by yielding `MessagePart` objects with `content_type: "application/json"` and partial JSON content. For structured pipelines, agents yield typed artifacts mid-stream:

```python
@server.agent()
async def scene_analyzer(messages: list[Message]) -> AsyncGenerator:
    # stream partial analysis as it builds
    async for chunk in analyze_frame_stream(get_frame(messages)):
        yield MessagePart(
            content_type="application/json",
            content=chunk,
            name="scene-graph-delta"   # named artifact
        )
```

---

## 6. SDK and Reference Implementation

### Python SDK (`acp-sdk` on PyPI)

- Server: `from acp_sdk.server import Server` — decorator-based agent registration (`@server.agent()`)
- Client: `from acp_sdk.client import Client` — async context manager with `run_sync`, `run_async`, `run_stream`, `agents()`
- Models: `Message`, `MessagePart`, `MessagePartEvent`, `MessageCompletedEvent`, `RunCompletedEvent`, `GenericEvent`
- FastAPI-based server with pluggable storage for sessions
- Supports distributed deployment with shared storage backends

### TypeScript SDK (`acp-sdk` on NPM)

- Client-only (no server implementation in TypeScript)
- TypeScript type definitions mirroring the Python models
- Same JSON schema derived from the shared OpenAPI spec

### BeeAI Platform

The reference deployment environment. Provides:
- Agent registry (the ACP discovery surface)
- `beeai list` / `beeai run` / `beeai compose` CLI commands
- Local dev via `brew install i-am-bee/beeai/beeai && beeai ui` (opens at localhost:8333)
- OTLP observability integration (traces to Arize Phoenix or similar)

### OpenAPI Spec

The canonical source of truth is `docs/spec/openapi.yaml` in the archived `i-am-bee/acp` repository. Because the repo is archived but not deleted, the spec remains accessible.

### Successor: A2A SDK

Since ACP merged into A2A, the active SDK going forward is `google/A2A`. BeeAI's documentation now points to A2A migration guides. ACP's OpenAPI-derived patterns (multipart messages, run lifecycle, SSE streaming) are being contributed as features into the A2A spec.

---

## 7. Adoption Status

### What Got Built

ACP was used primarily within IBM Research's BeeAI ecosystem. The cross-framework demos (BeeAI + crewAI + LangChain) showed genuine interoperability but were tutorial-scale, not reported production deployments.

**GitHub metrics at archival**: 952 stars, 114 forks, 28 contributors — a modest but real developer community for a 6-month-old protocol.

**DeepLearning.AI course**: Published and then replaced in February 2026 with an A2A course. Indicates ACP had enough traction for a major ML education platform to commission content.

### Who Was Behind It

IBM Research (primary author), contributed to Linux Foundation AI & Data. The ACP Technical Steering Committee included Kate Blair (IBM), who carried over to the A2A TSC alongside Google, Microsoft, AWS, Cisco, Salesforce, ServiceNow, and SAP.

### Honest Assessment

ACP did not achieve broad production adoption. Its lifecycle was too short (6 months from launch to archival). It was most relevant as a proof-of-concept that REST-native, multipart-message, session-aware agent communication could work cleanly, and that framing directly influenced A2A.

### The A2A Merger

A2A (Agent2Agent Protocol) was launched by Google in April 2025 — one month after ACP. Both targeted the same problem. The teams saw alignment and merged under Linux Foundation. The first issues bringing ACP features into A2A were opened immediately after the announcement.

ACP's contributions to A2A:
- REST-native architecture (A2A was JSON-RPC 2.0; ACP's REST simplicity is being evaluated for integration)
- Multipart MIME message structure
- Session management design
- Open governance experience (ACP had been in LFAI longer)

A2A's contributions to the merged standard:
- Broader industry backing (Google, Microsoft, AWS, Cisco, Salesforce, ServiceNow, SAP)
- More comprehensive feature set
- Stronger security model (cryptographic agent identity)
- Wider developer mindshare

**Practical implication**: Implementing ACP today means implementing a protocol with no active maintenance. Implementing A2A implements the living successor. For new work, A2A is the right target.

---

## 8. Relevance to Dazzle

Dazzle is an agentic broadcasting platform where AI agents drive live video streams. We already use MCP as our agent integration surface. The question is whether ACP (or its concepts, now living in A2A) is relevant for agent-to-agent communication, stream composability, or platform architecture.

### Where ACP's Ideas Are Directly Relevant

**Named Artifacts as Stream Output Contract**

ACP's `MessagePart.name` field — which turns a message part into a named, typed Artifact — is directly relevant to how agents should publish structured stream state. A stream-driving agent's output shouldn't be a blob of text; it should be named, typed artifacts:

```json
{
  "role": "agent",
  "parts": [
    {
      "content_type": "application/json",
      "name": "overlay-commands",
      "content": "{\"type\": \"ticker\", \"text\": \"BTC +2.3%\"}"
    },
    {
      "content_type": "application/json",
      "name": "scene-graph",
      "content": "{\"layout\": \"split\", \"slots\": [...]}"
    },
    {
      "content_type": "text/plain",
      "name": "commentary",
      "content": "Markets are showing unusual volatility..."
    }
  ]
}
```

A composing agent consuming this stream extracts `overlay-commands` by name, ignores `commentary`, and passes `scene-graph` to a layout agent. The contract is explicit in the message structure, not inferred from position or documentation.

**SSE Streaming as the Live Feed Primitive**

ACP's stream mode — `POST /runs` with `mode: "stream"` returning SSE `MessagePartEvent` deltas — maps cleanly onto a live stream feed. Each frame of agent-driven stream state is a delta event. Consumers accumulate deltas. This is exactly how a broadcasting platform should work: agents emit incremental state updates, not full snapshots.

The SSE approach is also simpler than WebSockets for unidirectional feeds (agent → platform → viewer), which is the dominant Dazzle data flow direction.

**Session Continuity for Long-Running Streams**

ACP sessions map to stream sessions. A 4-hour live stream is a single session. The session carries context (what has been discussed, what overlays have been shown, what segments have aired) so agents don't need to reconstruct history on every call. ACP's distributed session support (shared storage backend) means multiple agent instances can share session state — relevant when Dazzle scales horizontally.

**The AWAITING State for Human-in-the-Loop**

ACP's `AWAITING` run state — where an agent pauses and requests external input before proceeding — directly models moderation flows. A stream-driving agent can pause and request producer approval before airing a sensitive segment. The producer's response resumes the run. This is cleaner than modeling it as a separate tool call.

**Framework-Agnostic Agent Composition**

ACP demonstrated that agents built in different frameworks (BeeAI, crewAI, LangChain) can compose via a shared wire protocol. Dazzle will likely integrate third-party agents (a specialized music-selection agent, a sports-data agent, a moderation agent). If those agents speak A2A/ACP-style REST, they plug into Dazzle's composition layer without Dazzle needing to understand each agent's internal framework.

### What ACP Does Not Solve for Dazzle

**Real-Time Video/Audio Transport**

ACP is an agent coordination protocol, not a media transport. It moves JSON and MIME-typed blobs between agents, not video frames at 30fps. Dazzle still needs WebRTC, HLS, or a dedicated video pipeline for the actual stream. ACP handles what agents *say to each other*, not what viewers *watch*.

**Sub-100ms Latency**

ACP's REST+HTTP model has overhead inappropriate for frame-synchronized coordination. Each `POST /runs` is an HTTP round trip. For timing-critical operations (synchronizing an overlay to a specific video frame), ACP is too slow. A lower-latency internal bus (Redis pub/sub, WebSockets, or gRPC streaming) is needed for tight timing.

**Discovery of Agent Capabilities at Stream Time**

ACP discovery (`GET /agents`) returns static manifests. Dazzle needs dynamic capability negotiation — can the music agent handle the current genre? Does the sports-data agent have data for today's game? ACP manifests don't express runtime capability. This would need to be extended.

### Recommended Architecture Posture

ACP as a standalone protocol is archived. The right posture is:

1. **Adopt A2A, not ACP**, for any agent-to-agent protocol investment. A2A is ACP's living successor with industry backing and active development. ACP's core concepts (named artifacts, SSE streaming, run lifecycle, sessions) carry over.

2. **MCP stays as the tool integration layer**. Continue using MCP for agent-to-tool calls (databases, APIs, file systems). Nothing about ACP or A2A replaces this.

3. **Model stream output as named MIME-typed artifacts**. Adopt ACP's artifact naming convention as Dazzle's internal contract format — even without adopting the full ACP wire protocol. Agents produce named, typed parts; composing agents consume by name.

4. **Use SSE for stream state feeds**. ACP's streaming model (SSE push of typed delta events from a run) is the right pattern for broadcasting agent state to the platform. Each agent run that drives a stream segment emits `MessagePartEvent` deltas that the platform renders.

5. **Evaluate A2A for inter-agent communication**. If Dazzle integrates third-party agents or runs multiple specialized agents (layout, commentary, music, moderation) as coordinated peers, A2A provides the standard wire protocol. The coordination overhead is worth it once the agent count grows past ~3-4.

---

## Sources

- [Welcome - Agent Communication Protocol](https://agentcommunicationprotocol.dev/introduction/welcome)
- [GitHub - i-am-bee/acp (archived)](https://github.com/i-am-bee/acp)
- [What is Agent Communication Protocol (ACP)? — IBM](https://www.ibm.com/think/topics/agent-communication-protocol)
- [IBM's Agent Communication Protocol: A technical overview — WorkOS](https://workos.com/blog/ibm-agent-communication-protocol-acp)
- [Agent Communication Protocol — IBM Research](https://research.ibm.com/projects/agent-communication-protocol)
- [Discover & Run Agent — ACP Documentation](https://agentcommunicationprotocol.dev/how-to/discover-and-run-agent)
- [Compose Agents — ACP Documentation](https://agentcommunicationprotocol.dev/how-to/compose-agents)
- [MCP and A2A — ACP Documentation](https://agentcommunicationprotocol.dev/about/mcp-and-a2a)
- [ACP Joins Forces with A2A — LFAI & Data](https://lfaidata.foundation/communityblog/2025/08/29/acp-joins-forces-with-a2a-under-the-linux-foundations-lf-ai-data/)
- [A Survey of Agent Interoperability Protocols: MCP, ACP, A2A, ANP — arXiv](https://arxiv.org/html/2505.02279v1)
- [Using ACP for AI Agent Interoperability — IBM Tutorial](https://www.ibm.com/think/tutorials/acp-ai-agent-interoperability-building-multi-agent-workflows)
- [MCP, A2A, ACP: What does it all mean? — Akka](https://akka.io/blog/mcp-a2a-acp-what-does-it-all-mean)
- [Evolving Standards for Agentic Systems: MCP and ACP — Niklas Heidloff](https://heidloff.net/article/mcp-acp/)
- [Comparison of Agent Protocols MCP, ACP and A2A — Niklas Heidloff](https://heidloff.net/article/mcp-acp-a2a-agent-protocols/)
- [Top AI Agent Protocols in 2026 — GetStream.io](https://getstream.io/blog/ai-agent-protocols/)
- [ACP: Agent Communication Protocol — DeepLearning.AI](https://learn.deeplearning.ai/courses/acp-agent-communication-protocol/information)
- [DeepWiki: i-am-bee/acp](https://deepwiki.com/i-am-bee/acp)
- [Linux Foundation Launches Agent2Agent Protocol Project](https://www.linuxfoundation.org/press/linux-foundation-launches-the-agent2agent-protocol-project-to-enable-secure-intelligent-communication-between-ai-agents)
- [What Is MCP, ACP, and A2A? — Boomi](https://boomi.com/blog/what-is-mcp-acp-a2a/)
- [MCP, ACP, and A2A, Oh My! — Camunda](https://camunda.com/blog/2025/05/mcp-acp-a2a-growing-world-inter-agent-communication/)
