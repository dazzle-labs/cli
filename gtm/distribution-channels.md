# Distribution Channels

Where to publish Dazzle, what format each channel requires, and current status.

---

## The File Editing Problem (Solved)

John's concern: an MCP server means per-file read/write/update, not bulk sync. Built outputs (React, Vite) are annoying because each file write needs a build step.

**The answer:** The MCP server runs locally (stdio transport) and reads files directly from the local filesystem. It never passes file content through MCP's JSON-RPC. This is how Netlify, Tigris, and code-sync-mcp all work. It's the dominant pattern in the MCP ecosystem.

**The flow:**

1. Agent writes/edits files locally using its normal tools (Claude Code's Write/Edit, Cursor's file ops, etc.)
2. Agent calls `deploy(stage, "./my-project")` MCP tool
3. MCP server reads the local directory from disk
4. MCP server calls the existing SyncDiff/SyncPush RPCs to push to the stage
5. Sidecar extracts files, reloads browser

**This means zero sidecar changes and zero control plane changes.** The MCP server reuses the exact sync logic that the CLI already uses. The `deploy` tool does what `dazzle sync` does today.

**Built outputs:** Solved. The agent runs `npm run build` locally (or the build happens before deploy), then deploys `dist/`. Same as Netlify's MCP server, which zips the local build directory and uploads it.

**Screenshot/monitoring:** The MCP server calls the existing Screenshot/GetLogs/GetStats RPCs. Screenshots return as base64-encoded PNG in MCP's ImageContent type (standard pattern used by Playwright MCP, Puppeteer MCP).

**For remote MCP servers** (streamable-http, no local filesystem): expose per-file CRUD tools where content is a string parameter in tool args. Works for text files (HTML/CSS/JS, 1-50KB typical). This is a Phase 2 concern; the stdio (local) server covers the primary use case.

**Research sources:**
- Netlify MCP: zips local directory, uploads via HTTP outside MCP
- file-store-mcp: reads local paths, uploads to S3/COS outside MCP
- Tigris MCP: `tigris_put_object_from_path` reads from local disk
- code-sync-mcp: rsync batch from local disk over WebSocket
- Official filesystem MCP: `write_file(path, content)` as string param for local writes
- GitHub MCP: `push_files` takes array of {path, content} strings for multi-file commits
- SEP-1306 (binary mode elicitation): proposed, still unimplemented as of March 2026

---

## Repo Audit Summary

The control plane exposes 27 operations via ConnectRPC, authenticated with `dzl_*` API keys. The CLI is the primary consumer. No REST API or OpenAPI spec exists.

Key operations for agents:
- **Stage lifecycle**: create, activate, deactivate, delete, list, get
- **Content**: sync (diff + push), refresh
- **Interaction**: screenshot, emit event, get logs, get stats
- **Streaming**: create/attach/detach RTMP destinations
- **Browser**: CDP proxy (Chrome DevTools Protocol over WebSocket)

Auth: API key (`dzl_*` prefix, HMAC-SHA256 hashed server-side). Users create keys via web UI.

---

## Pareto Batch

One artifact: the MCP server. Zero changes to sidecar or control plane. It reuses the existing sync mechanism. Then six listings that cover every major agent ecosystem.

### What to build

1. **MCP server** (standalone Go binary, stdio transport). Wraps the existing ConnectRPC API: stage lifecycle, SyncDiff/SyncPush (reading from local filesystem), screenshot, logs, stats, RTMP destinations.

### What to ship (the six listings)

| # | Channel | Format | Effort | Reach |
|---|---|---|---|---|
| 1 | **Official MCP Registry** | server.json via `mcp-publisher publish` | 30 min | Auto-syncs to VS Code gallery + PulseMCP. Three listings from one publish. |
| 2 | **Smithery** | `smithery mcp publish <url>` | 15 min | Largest open MCP marketplace. |
| 3 | **ClawHub** | SKILL.md + `clawhub publish` | 1 hr | 337K-star ecosystem, 158K Discord, 10K+ skills. |
| 4 | **claude.com/plugins** | plugin.json wrapping MCP server | 2 hr | Top plugins 100K-370K installs. Verified badges. |
| 5 | **awesome-mcp-servers PR** | Link + description on GitHub | 15 min | Canonical MCP discovery list. |
| 6 | **r/AI_Agents post** | Demo video + link | 30 min | 296K members, largest agent-builder sub. |

**Coverage:**
- Every Claude Desktop user (official registry + plugin directory)
- Every VS Code/Copilot user (auto-synced from official registry)
- Every OpenClaw user (ClawHub)
- Every agent builder browsing GitHub (awesome lists)
- Reddit's largest agent community

---

## Format Reference

### Format A: MCP Server

Standalone Go binary. Takes `DAZZLE_API_KEY` and `DAZZLE_API_URL` env vars. Connects to control plane via ConnectRPC. Exposes tools over stdio (local) and streamable-http (remote).

Tools to expose:
- `create_stage(name, capabilities?)` creates a new stage
- `list_stages()` returns all stages with status
- `activate_stage(stage)` boots the pod, waits for running
- `deactivate_stage(stage)` stops the pod
- `delete_stage(stage)` removes permanently
- `deploy(stage, directory)` reads local directory, syncs to stage via existing SyncDiff/SyncPush, reloads browser. This is the core content tool. Agent writes files locally with its normal file tools, then calls deploy to push.
- `screenshot(stage)` returns PNG as base64 image content
- `get_logs(stage, limit?)` returns browser console logs
- `get_stats(stage)` returns FPS, uptime, output count
- `emit_event(stage, event, data)` sends a custom event to the page
- `refresh(stage)` reloads the browser without re-syncing
- `create_destination(name, platform, rtmp_url, stream_key)` creates RTMP destination
- `attach_destination(stage, destination)` starts streaming to destination
- `detach_destination(stage, destination)` stops streaming to destination

### Format B: Agent Skills SKILL.md

Open standard (agentskills.io). Supported by 30+ tools: Claude Code, Cursor, Codex, Copilot, Gemini CLI, Goose, Amp. A folder with a SKILL.md that teaches agents when and how to use Dazzle.

### Format C: Claude Code Plugin

`.claude-plugin/plugin.json` manifest bundling the MCP server + SKILL.md. Published to marketplace repos. Submitted to claude.com/plugins for verified badge.

### Format D: OpenClaw Skill

SKILL.md with `metadata.openclaw` frontmatter. Published to ClawHub via `clawhub publish`.

```yaml
---
name: dazzle-streaming
description: Create cloud browser stages for live streaming to Twitch/YouTube/Kick
version: 1.0.0
metadata:
  openclaw:
    requires:
      env:
        - DAZZLE_API_KEY
    primaryEnv: DAZZLE_API_KEY
    homepage: https://dazzle.tv
---
```

### Format E: .mcpb Bundle

ZIP archive for Claude Desktop's extension directory. Human-reviewed by Anthropic.

### Format F: Official MCP Registry Entry

`server.json` published via `mcp-publisher publish`. Namespace via GitHub OAuth (`io.github.dazzle-labs/dazzle-mcp`).

---

## All Channels (complete inventory)

### MCP Registries

| Channel | Format | Review | Reach | Pareto? |
|---|---|---|---|---|
| Official MCP Registry | F | None | Auto-syncs to VS Code + PulseMCP | YES |
| Claude Desktop Extensions | E | Human review | 100K-370K installs | Phase 2 |
| Smithery | A (URL) | None | Largest open marketplace | YES |
| MCP.so | GitHub issue | None | 16,670+ servers | Phase 2 |
| PulseMCP | Auto from registry | None | 12,770+ servers | FREE (auto) |
| LobeHub MCP | Submit | Community | 43,152+ servers | Phase 2 |
| Glama | Submit | None | Growing | Phase 2 |

### Claude Code Ecosystem

| Channel | Format | Review | Reach | Pareto? |
|---|---|---|---|---|
| claude.com/plugins | C | Human review, verified | 100K-370K installs | YES |
| anthropics/claude-plugins-official | C | PR/form | ~47 curated plugins | Phase 2 |
| claudemarketplaces.com | C in any repo | Auto-scraped hourly | 2,300+ skills indexed | FREE (auto) |
| awesome-claude-skills | B | PR review | Curated list | Phase 2 |

### OpenClaw Ecosystem

| Channel | Format | Review | Reach | Pareto? |
|---|---|---|---|---|
| ClawHub | D | None | 10K-13.7K skills, 337K stars, 158K Discord | YES |
| awesome-openclaw-skills | D | PR review | 5,211 curated | Phase 2 |
| openclawskills.best | Auto | None | 10K+ skills | FREE (auto) |

### Agent Tool Platforms

| Channel | Format | Review | Reach | Pareto? |
|---|---|---|---|---|
| Composio | H (OpenAPI) | Self-serve | 982 toolkits, 25K stars | Phase 2 |
| n8n | G (npm node) | Optional | 230K users, $40M ARR | Phase 2 |
| Apify Store | I (Docker) | Self-serve | 21.5K Actors, 50K users | Phase 2 |

### GitHub Awesome Lists

| List | Focus | Pareto? |
|---|---|---|
| wong2/awesome-mcp-servers | MCP servers (canonical) | YES |
| appcypher/awesome-mcp-servers | MCP servers (second) | Phase 2 |
| e2b-dev/awesome-ai-agents | AI autonomous agents | Phase 2 |
| kyrolabs/awesome-agents | Open-source agent tools | Phase 2 |
| terkelg/awesome-creative-coding | Creative coding tools | Phase 2 |
| slavakurilyak/awesome-ai-agents | 300+ agentic AI resources | Phase 2 |
| kaushikb11/awesome-llm-agents | LLM agent frameworks | Phase 2 |
| proj-airi/awesome-ai-vtubers | AI VTuber tools | Phase 2 |

### Agent Framework Communities

| Community | Where | Size | Pareto? |
|---|---|---|---|
| OpenClaw | Discord (158K), r/openclaw | Massive | Phase 2 (after ClawHub) |
| CrewAI | Discord (9K+), GitHub (44K stars) | Large | Phase 2 |
| LangChain | Discord (30K+), GitHub | Large | Phase 2 |
| Browser Use | GitHub (85K stars) | Very active | Phase 2 |
| AutoGen | Discord, GitHub | Growing | Phase 3 |

### Reddit (Agent-Focused)

| Subreddit | Size | Pareto? |
|---|---|---|
| r/AI_Agents | 296K+ | YES |
| r/ClaudeAI | Growing | Phase 2 |
| r/AutoGPT | Large | Phase 2 |
| r/LocalLLaMA | 650K+ | Phase 2 |

### Reddit (Creative Coding / Streaming)

| Subreddit | Size | Self-Promo Rules | Pareto? |
|---|---|---|---|
| r/SideProject | ~500K | Explicitly for sharing | Phase 2 |
| r/creativecoding | ~120K | Showcase-friendly | Phase 2 |
| r/generative | ~180K | Show output, not marketing | Phase 2 |
| r/alphaandbetausers | ~30K | Explicitly for feedback | Phase 2 |
| r/obs | ~60K | On-topic | Phase 2 |
| r/Twitch | ~1.5M | Weekly threads only | Phase 3 |
| r/WebDev | ~1M | Showoff Saturday only | Phase 3 |
| r/javascript | ~2.5M | Showoff Saturday only | Phase 3 |
| r/InternetIsBeautiful | ~17M | Must be free, no promo | Phase 3 |
| r/dataisbeautiful | ~22M | Needs data viz demo | Phase 3 |
| r/indiehackers | ~30K | Sharing welcomed | Phase 2 |
| r/VtuberTech | ~10K | AI VTuber angle | Phase 3 |

### Launch Platforms

| Platform | Notes | Pareto? |
|---|---|---|
| Hacker News (Show HN) | Lead with tech depth. Tue-Thu, 9-11am ET. | Phase 2 |
| Product Hunt | Capstone. Need ~400 supporters. AI Agents category. | Phase 3 |
| Indie Hackers (Show IH) | 23% conversion. Rewards vulnerability + metrics. | Phase 2 |
| Lobste.rs | Invite-only. Need member invite. | Phase 3 |
| Tildes | Invite-only. | Phase 3 |

### Discord Servers

| Server | Size | Pareto? |
|---|---|---|
| OpenClaw | 158K | Phase 2 (after ClawHub) |
| OBS | ~50K | Phase 2 |
| Remotion | ~5K | Phase 2 |
| The Coding Train | ~30K | Phase 2 |
| three.js | ~30K | Phase 2 |
| Reactiflux | ~200K | Phase 3 |
| CrewAI | ~9K | Phase 2 |
| LangChain | ~30K | Phase 2 |
| StreamElements | ~100K | Phase 3 |
| Anthropic | Active | Phase 2 |

### Paid Directories (from launch-playbook.md)

| Directory | Cost | Traffic | Pareto? |
|---|---|---|---|
| TAAFT | $347 | 7.8M/mo + newsletter + $300 PPC | Phase 2 |
| Toolify | $99 | 5.1M/mo, dofollow backlink | Phase 2 |
| Futurepedia | $497 | 500K/mo, newsletter to 250K | Phase 3 |
| BetaList | Free or $129 | 200K/mo, 12-15% conversion | Phase 2 |
| DevHunt | Free | "Product Hunt for devtools" | Phase 2 |
| Uneed | Free | Tool directory | Phase 2 |
| Peerlist | Free | Monday launches, top 3 get newsletter | Phase 2 |

### Agent Directories (submission forms)

| Directory | Scale | Pareto? |
|---|---|---|
| AI Agents Directory (aiagentsdirectory.com) | 2,287+ agents, landscape map | Phase 2 |
| AI Agents List (aiagentslist.com) | 600+ with reviews | Phase 2 |
| AI Agent Store (aiagentstore.ai) | Directory + news | Phase 2 |
| StackOne Landscape | 120+ tools, quarterly | Phase 3 |

### Newsletters

| Newsletter | Reach | Path | Pareto? |
|---|---|---|---|
| Ben's Bites | 115-158K, 45% open | news.bensbites.com upvotes | Phase 2 |
| The Rundown AI | 2M+, 52% open | rundown.ai/submit | Phase 2 |
| Console.dev | Dev tools | Submissions | Phase 2 |
| JavaScript Weekly | ~200K | Submissions | Phase 2 |
| TLDR | Large | Organic or sponsored | Phase 2 |
| Changelog | Dev news + podcast | Submissions | Phase 2 |
| Agentic AI Weekly | Academic + practitioner | Pitch | Phase 3 |
| Agentplex | Weekly agent projects | Pitch | Phase 3 |
| Building AI Agents | Weekly agent developments | Pitch | Phase 3 |

### Blogs / Dev Platforms

| Platform | Strategy | Pareto? |
|---|---|---|
| Dev.to (`#showdev`) | Technical post | Phase 2 |
| Hashnode | Architecture post | Phase 3 |
| HackerNoon | ~4M readers | Phase 3 |
| Echo JS | JS news, self-submit | Phase 2 |

### Social (Twitter/X, Bluesky, Mastodon)

**Hashtags**: `#creativecoding`, `#generativeart`, `#buildinpublic`, `#indiehackers`, `#devtools`, `#livecoding`, `#AgenticAI`, `#MCP`

**Accounts to engage**: @thecodingtrain, @levelsio, @marc_louvion, @simonw

**Bluesky**: Growing fast for devs, higher engagement than X.

**Mastodon**: vis.social (creative coding), fosstodon.org (FOSS).

---

## Build Order

### Phase 1: Build (the Pareto batch)

1. Build MCP server (Go, stdio transport). Reuses CLI's ConnectRPC client and sync logic.
2. Test end-to-end: Claude Code creates a stage, writes p5.js sketch locally, deploys it, takes screenshot, goes live

### Phase 2: Ship Pareto Batch (one session)

5. Publish to Official MCP Registry (auto-populates VS Code + PulseMCP)
6. Publish to Smithery
7. Publish to ClawHub
8. Submit Claude Code plugin to claude.com/plugins
9. PR to wong2/awesome-mcp-servers
10. Post in r/AI_Agents with demo

### Phase 3: Expand (after Pareto batch is live)

11. Show HN
12. Indie Hackers
13. Reddit creative coding subs
14. Discord communities (OpenClaw, OBS, Remotion, CrewAI)
15. Free directories (DevHunt, Uneed, Peerlist, BetaList)
16. Newsletter pitches
17. Agent directories (submission forms)
18. Awesome list PRs (all remaining)

### Phase 4: Capstone

19. Product Hunt launch (after building supporter base from Phase 2-3)
20. Paid directories (TAAFT, Toolify, Futurepedia)
21. Platform integrations (Composio, n8n, Apify)

---

## Blockers

| Blocker | Impact | Resolution |
|---|---|---|
| No MCP server | Blocks all registry/plugin listings | Build it (Phase 1). Zero sidecar/control-plane changes needed. |
| No OpenAPI spec | Blocks Composio (Phase 4 only) | Generate from protos when needed |
| Reddit karma for gated subs | Blocks r/Twitch, r/WebDev, r/javascript | Start engaging now, 2 weeks lead time |
| Lobste.rs invite | Blocks Lobste.rs posting | Find a member |
