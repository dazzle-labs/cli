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

# Add a stream destination and go live
dazzle destination create
dazzle destination set my-destination
dazzle stage broadcast on
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
| `dazzle obs` | `o` | Advanced streaming control (broadcast, RTMP config) |

### Stage subcommands

| Command | Shorthand | Description |
|---------|-----------|-------------|
| `dazzle stage list` | `s ls` | List stages |
| `dazzle stage create <name>` | `s new` | Create a stage |
| `dazzle stage delete <name>` | `s rm` | Delete a stage |
| `dazzle stage up` | `s up` | Activate a stage |
| `dazzle stage down` | `s down` | Deactivate a stage |
| `dazzle stage status` | `s st` | Show stage status |
| `dazzle stage sync <dir>` | `s sy` | Sync a local directory to stage (auto-refreshes browser) |
| `dazzle stage sync <dir> --watch` | `s sy -w` | Watch, re-sync, and auto-refresh on changes |
| `dazzle stage refresh` | `s r` | Manual reload (rarely needed — sync auto-refreshes) |
| `dazzle stage event emit <name> <json>` | `s ev e` | Push event to script |
| `dazzle stage screenshot` | `s ss` | Capture a screenshot |
| `dazzle stage logs` | `s l` | Retrieve console logs |
| `dazzle stage broadcast on` | `s bc on` | Start broadcasting |
| `dazzle stage broadcast off` | `s bc off` | Stop broadcasting |

## Global Flags

| Flag | Env var | Description |
|------|---------|-------------|
| `--json` | | Output as JSON (machine-readable) |
| `-s`, `--stage` | `DAZZLE_STAGE` | Stage name to use |
| `--api-url` | `DAZZLE_API_URL` | API URL (default: `https://stream.dazzle.fm`) |

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
