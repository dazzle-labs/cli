# dazzle CLI

The official CLI for [Dazzle](https://stream.dazzle.fm) — manage your streaming stages from the terminal.

## Installation

### macOS / Linux

```bash
curl -fsSL https://raw.githubusercontent.com/dazzle-labs/cli/main/install.sh | sh
```

Installs to `/usr/local/bin/dazzle`. Override with `INSTALL_DIR`:

```bash
INSTALL_DIR=~/.local/bin curl -fsSL https://raw.githubusercontent.com/dazzle-labs/cli/main/install.sh | sh
```

### Windows

Download `dazzle_Windows_x86_64` (or `arm64`) from the [releases page](https://github.com/dazzle-labs/cli/releases), rename it to `dazzle.exe`, and place it somewhere on your `PATH`.

### go install

```bash
go install github.com/dazzle-labs/cli/cmd/dazzle@latest
```

### GitHub Releases

Pre-built binaries for macOS (arm64/amd64), Linux (amd64/arm64), and Windows (amd64/arm64) are available on the [releases page](https://github.com/dazzle-labs/cli/releases).

## Quick Start

```bash
# Authenticate with your API key from stream.dazzle.fm/settings
dazzle login

# List your stages
dazzle stage list

# Activate a stage
dazzle stage start

# Set a script
dazzle script set my-script.jsx

# Capture a screenshot to see what's rendering
dazzle screenshot

# Push a live event to your running script
dazzle emit update '{"value": 42}'

# View console logs
dazzle logs --limit 50
```

## Commands

| Command | Alias | Description |
|---------|-------|-------------|
| `dazzle login` | | Authenticate with your API key |
| `dazzle logout` | | Clear stored credentials |
| `dazzle whoami` | | Show current user |
| `dazzle version` | | Print version information |
| `dazzle update` | | Update to the latest release |
| `dazzle stage` | `s` | Manage streaming stages |
| `dazzle script` | `sc` | Manage stage scripts |
| `dazzle emit` | `e` | Push events to running script |
| `dazzle logs` | `l` | Retrieve console logs |
| `dazzle screenshot` | `ss` | Capture a screenshot |
| `dazzle obs` | `o` | Control OBS on the active stage |
| `dazzle destination` | `dest` | Manage RTMP destinations |

### Stage subcommands

| Command | Alias | Description |
|---------|-------|-------------|
| `dazzle stage list` | `ls` | List stages |
| `dazzle stage create <name>` | `new` | Create a stage |
| `dazzle stage delete <name>` | `rm` | Delete a stage |
| `dazzle stage start` | `up` | Activate stage (start pod) |
| `dazzle stage stop` | `down` | Deactivate stage (stop pod) |
| `dazzle stage status` | `st` | Show stage status |
| `dazzle stage use <name>` | | Set default stage |

### Examples using short aliases

```bash
dazzle s ls          # dazzle stage list
dazzle s up          # dazzle stage start
dazzle s down        # dazzle stage stop
dazzle sc set app.jsx  # dazzle script set app.jsx
dazzle ss            # dazzle screenshot
dazzle l --limit 20  # dazzle logs --limit 20
```

## Global Flags

| Flag | Env var | Description |
|------|---------|-------------|
| `--json` | | Output as JSON (machine-readable) |
| `--stage` | `DAZZLE_STAGE` | Stage name or ID to use |
| `--api-url` | `DAZZLE_API_URL` | API URL (default: `https://stream.dazzle.fm`) |

## Stage Resolution

For stage-scoped commands, the stage is resolved in this order:

1. `--stage` flag
2. `DAZZLE_STAGE` environment variable
3. Default from `~/.config/dazzle/config.json` (set via `dazzle stage use`)
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
