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
dazzle s new my-stage
dazzle s up

# Push content (JS or JSX, hot-swapped via HMR)
dazzle s sc set my-overlay.jsx

# Take a screenshot to verify
dazzle s ss -o preview.png

# Go live on a configured destination
dazzle s live on
```

## Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `dazzle login` | | Authenticate with your API key |
| `dazzle logout` | | Clear stored credentials |
| `dazzle whoami` | | Show current user |
| `dazzle version` | | Print version information |
| `dazzle update` | | Update to the latest release |
| `dazzle stage` | `s` | Manage stages |
| `dazzle destination` | `dest` | Manage RTMP destinations |
| `dazzle obs` | `o` | Advanced OBS control |

### Stage subcommands

| Command | Alias | Description |
|---------|-------|-------------|
| `dazzle s ls` | `list` | List stages |
| `dazzle s new <name>` | `create` | Create a stage |
| `dazzle s rm <name>` | `delete` | Delete a stage |
| `dazzle s up` | `activate`, `start` | Activate a stage |
| `dazzle s down` | `deactivate`, `stop` | Deactivate a stage |
| `dazzle s st` | `status` | Show stage status |
| `dazzle s default <name>` | `use` | Set default stage |
| `dazzle s sc set <file>` | `script set` | Push JS/JSX to stage |
| `dazzle s sc get` | `script get` | Get current script |
| `dazzle s sc edit` | `script edit` | Find & replace in script |
| `dazzle s ev e <name> <json>` | `event emit` | Push event to script |
| `dazzle s ss` | `screenshot` | Capture a screenshot |
| `dazzle s l` | `logs` | Retrieve console logs |
| `dazzle s live on` | `stream start` | Go live |
| `dazzle s live off` | `stream stop` | Stop streaming |

## Global Flags

| Flag | Env var | Description |
|------|---------|-------------|
| `--json` | | Output as JSON (machine-readable) |
| `-s`, `--stage` | `DAZZLE_STAGE` | Stage name or ID to use |
| `--api-url` | `DAZZLE_API_URL` | API URL (default: `https://stream.dazzle.fm`) |

## Stage Resolution

For stage-scoped commands, the stage is resolved in this order:

1. `-s` / `--stage` flag
2. `DAZZLE_STAGE` environment variable
3. Default from `~/.config/dazzle/config.json` (set via `dazzle s default`)
4. Auto-select if you have exactly one stage

## Configuration

Config files are stored in `~/.config/dazzle/`:

```
~/.config/dazzle/
  config.json        # { "default_stage": "my-stage" }
  credentials.json   # { "api_key": "bstr_..." }
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
