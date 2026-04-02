# dazzle

The official CLI and MCP server for [Dazzle](https://dazzle.fm) — cloud stages for AI agents and live streaming.

One binary, two interfaces:
- **CLI** — full shell access for coding agents (Claude Code, Cursor, terminals) and automation
- **MCP server** (`dazzle mcp`) — stdio integration for sandboxed clients (Claude Desktop, VS Code, any MCP host)

<p align="center">
  <img src="https://dazzle.fm/static/demo.gif" alt="Dazzle CLI demo" width="700" />
</p>

## Installation

### macOS / Linux

```bash
curl -sSL https://dazzle.fm/install.sh | sh
```

### Windows (PowerShell)

```powershell
irm https://dazzle.fm/install.ps1 | iex
```

### Other options

```bash
go install github.com/dazzle-labs/cli/cmd/dazzle@latest
```

Pre-built binaries for macOS (arm64/amd64), Linux (amd64/arm64), and Windows (amd64/arm64) are on the [releases page](https://github.com/dazzle-labs/cli/releases).

## Quick Start (CLI)

```bash
dazzle login                              # authenticate (opens browser)
dazzle stage create my-stage              # create a stage
dazzle stage up                           # activate — starts streaming
dazzle stage sync ./my-app --watch        # push content, auto-refresh on changes
dazzle stage screenshot -o preview.png    # verify output
dazzle destination add                    # add Twitch/Kick/custom RTMP
dazzle destination attach my-destination  # go live
```

## Quick Start (MCP)

Add to your MCP client config:

```json
{
  "mcpServers": {
    "dazzle": {
      "command": "dazzle",
      "args": ["mcp"]
    }
  }
}
```

The MCP server starts without credentials — agents can call `guide` to learn the platform and `cli ["login"]` to authenticate.

## MCP Tools

| Tool | Description |
|------|------------|
| `cli` | Run a dazzle CLI command. Use ["--help"] to discover available commands. Output is JSON. |
| `edit_file` | Edit a file in the stage workspace by exact string replacement. The old_string must match exactly once in the file. Use read_file first to see the current content. |
| `guide` | Get the complete Dazzle reference — getting started, CLI commands, content capabilities, and streaming setup. Read this before creating or modifying stage content. |
| `list_files` | List all files in the stage workspace (~/.dazzle/stages/{stage}/). Returns relative paths, one per line. |
| `read_file` | Read a file from the stage workspace (~/.dazzle/stages/{stage}/{path}). |
| `screenshot` | Capture a screenshot of the stage's current browser output. Returns a PNG image. |
| `sync` | Sync the stage workspace (~/.dazzle/stages/{stage}/) to the live stage. Run this after writing files to push content. Equivalent to 'dazzle stage sync {workspace-dir}'. |
| `write_file` | Write a file to the stage workspace (~/.dazzle/stages/{stage}/{path}). Creates parent directories as needed. Use this to build up content that can then be synced to the stage. |

### Workspace tools

The workspace tools (`write_file`, `read_file`, `edit_file`, `list_files`, `sync`) store files in `~/.dazzle/stages/{stage-id}/` on the host filesystem. This bridges sandboxed environments (e.g. Claude Desktop) where the agent's bash runs in an isolated container and can't share files with the CLI process.

**Workflow:** `write_file` → `edit_file` (iterate) → `sync` → `screenshot` (verify)

**Limitations:** No shell/exec — can't run build tools (npm, tailwind, etc.) in the workspace. Content must be pre-built HTML/CSS/JS. Agents with full filesystem and shell access (e.g. Claude Code) should use `dazzle stage sync` directly for the full experience.

### MCP Resources

| URI | Description |
|-----|------------|
| `https://dazzle.fm/llms-full.txt` | Complete Dazzle reference — getting started, CLI help, and content authoring guide. |
| `https://dazzle.fm/llms.txt` | Dazzle quick-start guide — platform overview, setup, CLI basics, and doc links. |

## CLI vs MCP — which to use?

| | CLI | MCP |
|---|-----|-----|
| **Best for** | Coding agents, terminals, CI/CD | Claude Desktop, VS Code, sandboxed clients |
| **Filesystem** | Full access — write anywhere, run build tools | Workspace only (`~/.dazzle/stages/{id}/`) |
| **Shell** | Yes — npm, tailwind, any toolchain | No — pre-built content only |
| **Content sync** | `dazzle stage sync ./dir` | `write_file` + `sync` |
| **Screenshot** | `dazzle stage screenshot -o file.png` | `screenshot` tool (returns JPEG) |
| **Auth** | `dazzle login` or `DAZZLE_API_KEY` | `cli ["login"]` via MCP |

## CLI Reference

```
Usage: dazzle <command> [flags]

Dazzle — cloud stages for streaming.

A stage is a cloud browser environment that renders and streams your content.
Sync a local directory (must contain an index.html) and everything visible in
the browser window is what gets streamed to viewers.

Your content runs in a real browser with full access to standard web APIs (DOM,
Canvas, WebGL, Web Audio, fetch, etc.). localStorage is persisted across stage
restarts — use it to store app state that should survive between sessions.

Workflow:
 1. dazzle login # authenticate (one-time)
 2. dazzle s new my-stage # create a stage
 3. dazzle s up # bring it up — starts streaming to Dazzle
 4. dazzle s sync ./my-app -w # sync + auto-refresh on changes
 5. dazzle s ss -o preview.png # take a screenshot to verify
 6. dazzle s down # stop streaming and shut down

Stage selection: use -s <name>, DAZZLE_STAGE env, or auto-selected if only one.

https://dazzle.fm

Flags:
  -h, --help              Show context-sensitive help.
  -j, --json              Output as JSON.
  -s, --stage=STRING      Stage name or ID ($DAZZLE_STAGE).
      --api-url=STRING    API URL ($DAZZLE_API_URL).

Commands:
  version                          Print version information.
  update                           Update dazzle to the latest release.
  guide                            Show content authoring guide (rendering tips,
                                   performance, best practices).
  login                            Authenticate with Dazzle (opens browser).
  logout                           Clear stored credentials.
  whoami                           Show current user.
  stage (s) list (ls)              List stages.
  stage (s) create (new)           Create a stage.
  stage (s) delete (rm)            Delete a stage.
  stage (s) up                     Activate a stage.
  stage (s) down                   Deactivate a stage.
  stage (s) status (st)            Show stage status.
  stage (s) stats                  Show live pipeline stats.
  stage (s) preview                Show the shareable preview URL for a running
                                   stage.
  stage (s) sync (sy)              Sync a local directory to the stage. This is
                                   the primary way to push content — use --watch
                                   for live development.
  stage (s) refresh (r)            Reload the stage entry point.
  stage (s) event (ev) emit (e)    Push a named event with JSON data to
                                   the running page — dispatched as a DOM
                                   CustomEvent. Use this to send real-time data
                                   from external processes (other agents, APIs,
                                   etc.) without re-syncing or reloading.
  stage (s) logs (l)               Retrieve stage console logs.
  stage (s) screenshot (ss)        Capture a screenshot of the stage.
  stage (s) info                   Get current stream title and category.
  stage (s) title                  Set the stream title (not supported for
                                   Restream).
  stage (s) category               Set the stream category or game (not
                                   supported for Restream).
  stage (s) chat send              Send a message to live chat (not supported
                                   for Restream).
  destination (dest) list (ls)     List broadcast destinations.
  destination (dest) add (create,new)
                                   Add a broadcast destination.
  destination (dest) delete (rm)
                                   Remove a broadcast destination.
  destination (dest) attach (set)
                                   Attach a destination to a stage.
  destination (dest) detach (unset)
                                   Detach a destination from a stage.

Run "dazzle <command> --help" for more information on a command.
```

<details>
<summary>Stage subcommands</summary>

```
Usage: dazzle stage (s) <command> [flags]

Manage stages — create, sync content, screenshot, stream.

Flags:
  -h, --help              Show context-sensitive help.
  -j, --json              Output as JSON.
  -s, --stage=STRING      Stage name or ID ($DAZZLE_STAGE).
      --api-url=STRING    API URL ($DAZZLE_API_URL).

Commands:
  stage (s) list (ls)              List stages.
  stage (s) create (new)           Create a stage.
  stage (s) delete (rm)            Delete a stage.
  stage (s) up                     Activate a stage.
  stage (s) down                   Deactivate a stage.
  stage (s) status (st)            Show stage status.
  stage (s) stats                  Show live pipeline stats.
  stage (s) preview                Show the shareable preview URL for a running
                                   stage.
  stage (s) sync (sy)              Sync a local directory to the stage. This is
                                   the primary way to push content — use --watch
                                   for live development.
  stage (s) refresh (r)            Reload the stage entry point.
  stage (s) event (ev) emit (e)    Push a named event with JSON data to
                                   the running page — dispatched as a DOM
                                   CustomEvent. Use this to send real-time data
                                   from external processes (other agents, APIs,
                                   etc.) without re-syncing or reloading.
  stage (s) logs (l)               Retrieve stage console logs.
  stage (s) screenshot (ss)        Capture a screenshot of the stage.
  stage (s) info                   Get current stream title and category.
  stage (s) title                  Set the stream title (not supported for
                                   Restream).
  stage (s) category               Set the stream category or game (not
                                   supported for Restream).
  stage (s) chat send              Send a message to live chat (not supported
                                   for Restream).
```

#### `stage sync` flags

```
Usage: dazzle stage (s) sync (sy) <dir> [flags]

Sync a local directory to the stage. This is the primary way to push content —
use --watch for live development.

Arguments:
  <dir>    Local directory to sync (must contain an index.html entry point).

Flags:
  -h, --help                  Show context-sensitive help.
  -j, --json                  Output as JSON.
  -s, --stage=STRING          Stage name or ID ($DAZZLE_STAGE).
      --api-url=STRING        API URL ($DAZZLE_API_URL).

  -w, --watch                 Watch for file changes and automatically re-sync.
      --entry="index.html"    HTML entry point file (default: index.html).
```

#### `stage screenshot` flags

```
Usage: dazzle stage (s) screenshot (ss) [flags]

Capture a screenshot of the stage.

Flags:
  -h, --help              Show context-sensitive help.
  -j, --json              Output as JSON.
  -s, --stage=STRING      Stage name or ID ($DAZZLE_STAGE).
      --api-url=STRING    API URL ($DAZZLE_API_URL).

  -o, --out=STRING        Output file path (default: temp file).
```

#### `stage event` subcommands

```
Usage: dazzle stage (s) event (ev) <command>

Send real-time data to the running page without reloading. Events are dispatched
as DOM CustomEvents — use this for async updates from subagents, APIs, or other
processes.

Flags:
  -h, --help              Show context-sensitive help.
  -j, --json              Output as JSON.
  -s, --stage=STRING      Stage name or ID ($DAZZLE_STAGE).
      --api-url=STRING    API URL ($DAZZLE_API_URL).

Commands:
  stage (s) event (ev) emit (e)    Push a named event with JSON data to
                                   the running page — dispatched as a DOM
                                   CustomEvent. Use this to send real-time data
                                   from external processes (other agents, APIs,
                                   etc.) without re-syncing or reloading.
```

</details>

<details>
<summary>Destination subcommands</summary>

```
Usage: dazzle destination (dest) <command> [flags]

Manage broadcast destinations (Twitch, YouTube, etc).

Flags:
  -h, --help              Show context-sensitive help.
  -j, --json              Output as JSON.
  -s, --stage=STRING      Stage name or ID ($DAZZLE_STAGE).
      --api-url=STRING    API URL ($DAZZLE_API_URL).

Commands:
  destination (dest) list (ls)    List broadcast destinations.
  destination (dest) add (create,new)
                                  Add a broadcast destination.
  destination (dest) delete (rm)
                                  Remove a broadcast destination.
  destination (dest) attach (set)
                                  Attach a destination to a stage.
  destination (dest) detach (unset)
                                  Detach a destination from a stage.
```

</details>

## Stage Resolution

For stage-scoped commands, the stage is resolved in this order:

1. `-s` / `--stage` flag or `DAZZLE_STAGE` environment variable
2. Auto-select if you have exactly one stage

```bash
dazzle stage sync ./app --stage my-stage   # explicit
export DAZZLE_STAGE=my-stage               # or set for your session
```

## Configuration

```
~/.config/dazzle/
  config.json        # { "api_url": "..." }
  credentials.json   # { "api_key": "dzl_..." }
```

## Security

- API key stored at `~/.config/dazzle/credentials.json` with `0600` permissions
- Transmitted as `Bearer` token over HTTPS only
- **Never logged, never echoed, never sent to third parties**
- **No telemetry** — no usage data, crash reports, or analytics
- All source code is open source and auditable

## License

Apache 2.0 — see [LICENSE](LICENSE)
