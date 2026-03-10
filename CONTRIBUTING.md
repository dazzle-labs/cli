# Contributing

## Development

```bash
git clone https://github.com/dazzle-labs/cli
cd cli
go build ./...
go run . --help
```

No external tooling required beyond a Go 1.23+ toolchain.

## Commit messages

Use [conventional commits](https://www.conventionalcommits.org/) — the prefix determines which section of the release changelog your change appears in:

| Prefix | Changelog section |
|--------|------------------|
| `feat:` / `feat(scope):` | New features |
| `fix:` / `fix(scope):` | Bug fixes |
| `docs:`, `test:`, `chore:` | Excluded from changelog |
| anything else | Other changes |

Examples:

```
feat: add dazzle stage rename command
fix: resolve stage auto-select when one stage exists
docs: update README install instructions
chore: bump dependencies
```

## Adding a command

1. Create (or add to) a `<topic>.go` file in the root
2. Define a `XxxCmd` struct with Kong field tags
3. Implement `func (c *XxxCmd) Run(ctx *Context) error`
4. Register it in the `cli` struct in `main.go`

Follow the existing pattern:
- Call `ctx.requireAuth()` at the top of `Run` for authenticated commands
- Call `ctx.resolveStage()` for stage-scoped commands
- Use `printText(...)` for human output and `printJSON(v)` for `--json` mode

## README

`README.md` is generated from `README.md.tmpl` — **do not edit `README.md` directly**. The template embeds actual `--help` output so the docs never drift from the code.

To regenerate:
```bash
make readme
```

The pre-commit hook (installed automatically when you run any `make` target) regenerates and stages `README.md` on every commit. CI also fails if `README.md` is stale.

## CI

CI runs on every push to `main` and on pull requests:
- `go build ./...`
- `go test ./...`
- `golangci-lint` (the `unused` linter is enabled — delete dead code rather than leaving it)
- `make readme` + diff check — fails if `README.md` doesn't match the template output

## Releases

Only maintainers publish releases. A release is triggered by pushing a semver tag:

```bash
git tag v1.2.3
git push origin v1.2.3
```

For betas:

```bash
git tag v1.2.3-beta.1
git push origin v1.2.3-beta.1
```

Goreleaser handles cross-compilation, packaging, and the GitHub Release automatically.
