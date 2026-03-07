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

### Production cluster
```bash
make prod/status                 # Show prod cluster nodes and pods
make prod/kubectl ARGS="..."     # Run kubectl against prod
```

### Production infrastructure (OpenTofu) — REQUIRES HUMAN APPROVAL
```bash
make prod/infra/plan             # Plan changes (read-only, safe)
make prod/infra/apply            # ⚠️  Apply changes (DESTRUCTIVE — modifies live infra)
```

**LLM SAFETY RULE: NEVER run `make prod/infra/apply` or `tofu apply` without explicit human approval.** These commands modify live production infrastructure (servers, load balancers, networking). Always run `prod/infra/plan` first and have the user review the plan output before applying. Terraform state is SOPS-encrypted in the repo — no state locking exists, so only one person should run infra commands at a time.

Remote builds and deploys are managed by CI/CD. See [docs/index.md](docs/index.md) for everything else.

## llms.txt

`llms.txt` is a static heredoc in `scripts/generate-llms-txt.sh`. Run `make llms-txt` to regenerate. Edit the shell script directly to update content.

## Proto / API types

Proto interfaces are split into public and internal:

- **Public** (`dazzle.v1`) — Stage, Runtime, Stream, User. Proto source + generated Go live in `cli/` (git submodule → `github.com/dazzle-labs/cli`). These are the client-facing APIs.
- **Internal** (`dazzle.internal.v1`) — ApiKey. Proto source in `control-plane/proto/api/v1/`, generated Go in `control-plane/internal/gen/`. Go's `internal/` directory enforces access restriction.

A `go.work` file at the repo root wires up `./control-plane` and `./cli` so local builds always use the local submodule — no tagging needed during development.

### Changing public proto definitions

1. Edit the `.proto` files in `cli/proto/api/v1/`
2. Regenerate: `cd cli && make proto`
3. Build locally to verify: `cd control-plane && go build ./...` (go.work picks up local changes)
4. When ready to ship: commit + tag cli, then `cd control-plane && go get github.com/dazzle-labs/cli@<new-tag>`

### Changing internal proto definitions

1. Edit `control-plane/proto/api/v1/apikey.proto`
2. Regenerate: `cd control-plane/proto && buf generate`
3. Commit the updated files in `control-plane/internal/gen/`
