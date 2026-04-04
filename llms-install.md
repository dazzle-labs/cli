# Installing the Dazzle MCP Server

## Prerequisites

- macOS, Linux, or Windows
- A Dazzle account (sign up at https://dazzle.fm)

## Install the CLI

**macOS / Linux:**
```bash
curl -sSL https://dazzle.fm/install.sh | sh
```

**Windows (PowerShell):**
```powershell
irm https://dazzle.fm/install.ps1 | iex
```

**Or via Go:**
```bash
go install github.com/dazzle-labs/cli/cmd/dazzle@latest
```

## Authenticate

```bash
dazzle login
```

This opens your browser for OAuth sign-in. Credentials are stored in `~/.config/dazzle/credentials.json`.

For headless/CI use, set `DAZZLE_API_KEY=dzl_your_key_here` instead.

## Configure MCP

Add to your MCP client config. If you installed the CLI binary:

```json
{
  "mcpServers": {
    "dazzle": {
      "command": "dazzle",
      "args": ["mcp"],
      "env": {
        "DAZZLE_API_KEY": "dzl_your_key_here"
      }
    }
  }
}
```

Or use npx (no install required, just needs Node.js):

```json
{
  "mcpServers": {
    "dazzle": {
      "command": "npx",
      "args": ["@dazzle-labs/cli", "mcp"],
      "env": {
        "DAZZLE_API_KEY": "dzl_your_key_here"
      }
    }
  }
}
```

The `DAZZLE_API_KEY` env var is optional if you've already run `dazzle login`. Other env vars: `DAZZLE_STAGE` (pin to a stage), `DAZZLE_API_URL` (custom API endpoint).

Restart your MCP client. The dazzle MCP server provides 8 tools: `cli`, `screenshot`, `write_file`, `read_file`, `edit_file`, `list_files`, `sync`, and `guide`.

## Verify

After setup, call the `guide` tool to fetch the quick-start reference, or `cli` with `["stage", "list"]` to verify authentication works.
