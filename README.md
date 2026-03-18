# dazzle CLI

The official CLI for [Dazzle](https://stream.dazzle.fm) — manage your cloud stages from the terminal.

## Installation

### macOS / Linux

```bash
curl -sSL https://stream.dazzle.fm/install.sh | sh
```

Installs to `~/.local/bin/dazzle`. Override with `INSTALL_DIR`:

```bash
INSTALL_DIR=/usr/local/bin curl -sSL https://stream.dazzle.fm/install.sh | sh
```

### Windows (PowerShell)

```powershell
irm https://stream.dazzle.fm/install.ps1 | iex
```

Or download `dazzle_Windows_x86_64.exe` (or `arm64`) from the [releases page](https://github.com/dazzle-labs/cli/releases) and add it to your `PATH`.

### go install

```bash
go install github.com/dazzle-labs/cli/cmd/dazzle@latest
```

### GitHub Releases

Pre-built binaries for macOS (arm64/amd64), Linux (amd64/arm64), and Windows (amd64/arm64) are available on the [releases page](https://github.com/dazzle-labs/cli/releases).

## Quick Start

```bash
# Authenticate with your API key from stream.dazzle.fm
dazzle login

# Create and activate a stage
dazzle stage create my-stage
dazzle stage up

# Sync a local directory to the stage
dazzle stage sync ./my-app --watch

# Take a screenshot to verify
dazzle stage screenshot -o preview.png

# Add a broadcast destination and go live
dazzle destination create
dazzle destination set my-destination
dazzle stage broadcast on
```

## Commands

```
Usage: dazzle <command> [flags]

Dazzle — cloud stages for broadcasting.

A stage is a cloud browser environment that renders and broadcasts your content.
Sync a local directory (must contain an index.html) and everything visible in
the browser window is what gets broadcast to viewers.

Your content runs in a real browser with full access to standard web APIs (DOM,
Canvas, WebGL, Web Audio, fetch, etc.). localStorage is persisted across stage
restarts — use it to store app state that should survive between sessions.

Workflow:
 1. dazzle login # authenticate (one-time)
 2. dazzle s new my-stage # create a stage
 3. dazzle s up # bring it up
 4. dazzle s sync ./my-app -wr # sync + watch + reload on changes
 5. dazzle s ss -o preview.png # take a screenshot to verify
 6. dazzle s bc on # go live on configured destination
 7. dazzle s bc off && dazzle s down # stop streaming and shut down

Stage selection: use -s <name>, DAZZLE_STAGE env, or auto-selected if only one.

https://stream.dazzle.fm

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
  stage (s) broadcast (bc) on (start)
                                   Start broadcasting to the configured
                                   destination.
  stage (s) broadcast (bc) off (stop)
                                   Stop the broadcast.
  stage (s) broadcast (bc) status (st)
                                   Check broadcast status.
  stage (s) broadcast (bc) info    Get current stream title and category.
  stage (s) broadcast (bc) title
                                   Set the stream title (not supported for
                                   Restream).
  stage (s) broadcast (bc) category
                                   Set the stream category or game (not
                                   supported for Restream).
  stage (s) chat send              Send a message to live chat (not supported
                                   for Restream).
  destination (dest) list (ls)     List broadcast destinations.
  destination (dest) add (create,new)
                                   Add a broadcast destination.
  destination (dest) delete (rm)
                                   Remove a broadcast destination.
  destination (dest) set           Assign a broadcast destination to the active
                                   stage.

Run "dazzle <command> --help" for more information on a command.
```

### Stage subcommands

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
  stage (s) broadcast (bc) on (start)
                                   Start broadcasting to the configured
                                   destination.
  stage (s) broadcast (bc) off (stop)
                                   Stop the broadcast.
  stage (s) broadcast (bc) status (st)
                                   Check broadcast status.
  stage (s) broadcast (bc) info    Get current stream title and category.
  stage (s) broadcast (bc) title
                                   Set the stream title (not supported for
                                   Restream).
  stage (s) broadcast (bc) category
                                   Set the stream category or game (not
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

#### `stage broadcast` subcommands

```
Usage: dazzle stage (s) broadcast (bc) <command>

Broadcast to a streaming destination.

Flags:
  -h, --help              Show context-sensitive help.
  -j, --json              Output as JSON.
  -s, --stage=STRING      Stage name or ID ($DAZZLE_STAGE).
      --api-url=STRING    API URL ($DAZZLE_API_URL).

Commands:
  stage (s) broadcast (bc) on (start)
                                   Start broadcasting to the configured
                                   destination.
  stage (s) broadcast (bc) off (stop)
                                   Stop the broadcast.
  stage (s) broadcast (bc) status (st)
                                   Check broadcast status.
  stage (s) broadcast (bc) info    Get current stream title and category.
  stage (s) broadcast (bc) title
                                   Set the stream title (not supported for
                                   Restream).
  stage (s) broadcast (bc) category
                                   Set the stream category or game (not
                                   supported for Restream).
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

### Destination subcommands

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
  destination (dest) set          Assign a broadcast destination to the active
                                  stage.
```

## Stage Resolution

For stage-scoped commands, the stage is resolved in this order:

1. `-s` / `--stage` flag or `DAZZLE_STAGE` environment variable
2. Auto-select if you have exactly one stage

```bash
# Specify which stage to use
dazzle stage sync ./app --stage my-stage
dazzle stage status --stage my-stage

# Or set for your session
export DAZZLE_STAGE=my-stage
dazzle stage sync ./app
```

## Configuration

Config files are stored in `~/.config/dazzle/`:

```
~/.config/dazzle/
  config.json        # { "api_url": "..." }
  credentials.json   # { "api_key": "dzl_..." }
```

## Security

- Your API key is stored in `~/.config/dazzle/credentials.json` with file permissions `0600` (owner read/write only)
- The API key is transmitted as a `Bearer` token in the `Authorization` header over HTTPS
- The API key is **never logged**, **never echoed to the terminal**, and **never sent to any third party**
- Input is hidden during interactive `dazzle login` (no shell history exposure)
- **No telemetry**: the CLI does not collect usage data, crash reports, or analytics of any kind
- All source code is open source and auditable: `github.com/dazzle-labs/cli`
- All dependencies are minimal and listed in `go.sum`: only `kong` (CLI framework), `connectrpc` (RPC client), `protobuf` (serialization), and `golang.org/x/term` (hidden input)

## License

Apache 2.0 — see [LICENSE](LICENSE)
