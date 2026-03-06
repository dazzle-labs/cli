# CLAUDE.md

For complete architecture, build, deployment, and development guidance, see **[docs/index.md](docs/index.md)**.

## Quick Start

```bash
make dev    # Builds everything, starts Kind cluster, runs web dev server + log tail
```

This is the primary command for local development. It runs `make up` (build images, create cluster, deploy), then starts web dev server + control-plane log tail in parallel.

## Make Commands

### Local (Kind) — default
```bash
make dev                         # ★ Full local dev — build, deploy, watch everything
make up                          # Create Kind cluster, build images, deploy full stack
make down                        # Delete the Kind cluster
make build                       # Build all images and load into Kind
make build-cp                    # Build control-plane image and load into Kind
make build-streamer              # Build streamer image and load into Kind
make deploy                      # Apply manifests and restart control-plane in Kind
make logs                        # Tail control-plane logs in Kind
make status                      # Show pods and services in Kind
make proto                       # Generate protobuf code (Go + TypeScript)
make web/dev                     # Run web dev server only
```

Secrets are SOPS-encrypted in `k8s/local/local.secrets.yaml` (requires Age key). See [docs/local-dev.md](docs/local-dev.md).

Remote builds and deploys are managed by CI/CD. See [docs/index.md](docs/index.md) for everything else.

## llms.txt

`llms.txt` is generated from sources of truth — run `make llms-txt` to regenerate it. Sources:
- **MCP tool definitions** — extracted from `control-plane/mcp.go` via Go AST (`scripts/extract-mcp-tools.go`)
- **Framework examples** — extracted from `web/src/components/onboarding/frameworks.ts` (`scripts/extract-frameworks.cjs`)
- **Static sections** — getting started, auth, API, OBS (in `scripts/generate-llms-txt.sh`)

When updating MCP tools or framework examples, regenerate with `make llms-txt`. Static sections (getting started flow, API tables, OBS commands) must be updated manually in `scripts/generate-llms-txt.sh`.

## Proto / API types

The `.proto` source files live in `control-plane/proto/api/v1/`. The generated Go types are **not** kept in this repo — they live in `github.com/dazzle-labs/cli/gen/api/v1` (public), which the control-plane imports as a Go dependency.

### When proto definitions change

1. Edit the `.proto` files in `control-plane/proto/api/v1/`
2. Regenerate: `make proto` — this writes into a temporary local `gen/` directory
3. Copy to dazzle-cli:
   ```bash
   cp -r control-plane/gen/api/v1/. ../dazzle-cli/gen/api/v1/
   ```
4. Commit and tag a new release in `dazzle-cli`
5. Update the dependency here:
   ```bash
   cd control-plane && go get github.com/dazzle-labs/cli@<new-tag>
   ```
6. Commit and push

The `go_package` option in all `.proto` files is set to `github.com/dazzle-labs/cli/gen/api/v1;apiv1` so generated files are ready to drop into dazzle-cli without any import path changes.
