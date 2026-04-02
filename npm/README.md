# @dazzle-labs/cli

The official CLI for [Dazzle](https://dazzle.fm) — cloud stages for AI agents and live streaming.

## Install

```bash
npm install -g @dazzle-labs/cli
```

Or run directly:

```bash
npx @dazzle-labs/cli --help
```

## Usage

```bash
dazzle login                          # authenticate
dazzle stage new my-stage             # create a stage
dazzle stage up                       # activate
dazzle stage sync ./my-app --watch    # push content
dazzle stage screenshot -o preview.png
```

## MCP Server

The CLI includes a built-in MCP server for AI agent integration (Claude Desktop, Claude Code, VS Code, Cursor):

```json
{
  "mcpServers": {
    "dazzle": {
      "command": "npx",
      "args": ["@dazzle-labs/cli", "mcp"]
    }
  }
}
```

## How this package works

This is a thin wrapper that resolves the correct platform-specific binary from an optional dependency (`@dazzle-labs/cli-darwin-arm64`, `@dazzle-labs/cli-linux-x64`, etc.). No postinstall scripts are used.

## Documentation

- [Full reference](https://dazzle.fm/llms-full.txt)
- [Content authoring guide](https://dazzle.fm/guide.md)
- [Source](https://github.com/dazzle-labs/cli)
