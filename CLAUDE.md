# CLAUDE.md

## Project

`dazzle` is a CLI for the Dazzle streaming platform. It talks to the Dazzle control-plane API via ConnectRPC (protobuf over HTTP).

## Structure

All Go files live in `cmd/dazzle/` as `package main`. This lets `go install github.com/dazzle-labs/cli/cmd/dazzle@latest` install the binary as `dazzle`.

```
cmd/dazzle/               # package main — all CLI source files
proto/api/v1/             # Proto source files (dazzle.v1 — public API contract)
gen/api/v1/               # Generated protobuf types (package apiv1)
gen/api/v1/apiv1connect/  # Generated ConnectRPC clients (package apiv1connect)
```

This repo owns the public API definitions (`dazzle.v1`). To regenerate after editing proto files:

```bash
make proto
```

## Key patterns

- **CLI framework**: Kong (`github.com/alecthomas/kong`) — struct tags, not Cobra
- **RPC**: ConnectRPC clients — `apiv1connect.NewXxxServiceClient(ctx.HTTPClient, ctx.APIURL)`
- **Auth**: Bearer token set per-request via `req.Header().Set("Authorization", ctx.authHeader())`
- **Stage resolution**: `ctx.resolveStage()` — global `--stage` flag / `DAZZLE_STAGE` env → auto-select single stage
- **Output**: `printText(...)` for human, `printJSON(v)` for `--json` mode
- **Config/creds**: stored in `~/.config/dazzle/` at 0600 perms

## Commit messages

Use conventional commit prefixes — they control changelog grouping in releases:

| Prefix | Changelog section |
|--------|------------------|
| `feat:` or `feat(scope):` | New features |
| `fix:` or `fix(scope):` | Bug fixes |
| anything else | Other changes |
| `docs:`, `test:`, `chore:` | excluded from changelog |

Examples:
```
feat: add dazzle stage rename command
fix: resolve stage auto-select when one stage exists
chore: update dependencies
```

## Releases

Releases are triggered by pushing a semver tag. Goreleaser builds binaries for macOS (arm64/amd64), Linux (amd64/arm64), and Windows (amd64/arm64), then publishes a GitHub Release with grouped changelog and Discord notification to #deployments.

```bash
# Stable release
git tag v1.2.3
git push origin v1.2.3

# Pre-release / beta
git tag v1.2.3-beta.1
git push origin v1.2.3-beta.1
```

CI (`.github/workflows/ci.yml`) runs on every push to `main` and on PRs: golangci-lint, `go build ./...`, `go test ./...`.

## API URL

Default: `https://stream.dazzle.fm`. Override with `--api-url` flag or `DAZZLE_API_URL` env var.
