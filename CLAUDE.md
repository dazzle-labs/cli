# CLAUDE.md

For complete architecture, build, deployment, and development guidance, see **[docs/index.md](docs/index.md)**.

For the stage runtime (Rust GPU renderer), see **[docs/architecture-stage-runtime.md](docs/architecture-stage-runtime.md)**.

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
make build-sidecar               # Build sidecar image and load into Kind
make build-ingest                # Build ingest (nginx-rtmp) image and load into Kind
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

### GPU development (RunPod)
```bash
make gpu/rebuild                 # Build sidecar + GPU agent for amd64, push to Docker Hub
make gpu/deploy                  # Deploy control-plane with current GPU agent image tag
make gpu/node-create             # Create a GPU node (applies GPUNode CR)
make gpu/node-delete             # Delete the GPU node (terminates RunPod pod)
make gpu/node-recreate           # Delete + recreate GPU node (pulls fresh image)
make gpu/status                  # Show GPU node status and stages
make gpu/logs                    # Tail control-plane logs
make gpu/port-forward            # Port-forward control-plane for CLI access
```

### CLI (local, requires `make gpu/port-forward` in another terminal)
```bash
make cli/stages                  # List stages
make cli/up STAGE=name           # Activate a stage
make cli/down STAGE=name         # Deactivate a stage
make cli/sync STAGE=name DIR=.   # Sync content to a stage
make cli/screenshot STAGE=name   # Take a screenshot
make cli/logs STAGE=name         # Show stage console logs
```

Remote builds and deploys are managed by CI/CD. See [docs/index.md](docs/index.md) for everything else.

## Dev Auth Bypass (local GPU testing without Clerk)

The web app supports a dev-only auth mode that injects a test token without requiring Clerk. This lets you test GPU stage creation/activation locally.

Set in `web/src/main.tsx` — when `VITE_DEV_AUTH=true` (or running on localhost without a Clerk key), `DevApp.tsx` is used instead of the normal `App.tsx`. It calls `useDevToken` which hits `GET /auth/dev-token` on the control-plane and stores the result as a fake session.

To enable:
1. Set `DEV_AUTH_BYPASS=true` on the control-plane deployment (already set in `k8s/local/`)
2. Run `make web/dev` — the dev server picks it up automatically on localhost

## Conventions

- **UUIDv7 for all new IDs** — Use `uuid.Must(uuid.NewV7())` in Go, not `uuid.New()` or `uuid.NewString()`. UUIDv7 is time-ordered which improves index locality and makes IDs sortable by creation time. Existing UUIDv4 IDs in the DB are fine; only new code should use v7.

## Feature Development Workflow

Use **one worktree per session**. Create a worktree off `main` via `EnterWorktree` at the start of a session and do all work there. CLI submodule changes can be committed/pushed from within `cli/` in the same worktree — no need for a separate worktree.

**Do NOT spawn parallel sub-agents in separate worktrees** — work sequentially to keep costs down.

Worktrees must always branch off `main` from the root repository — never create nested worktrees or worktrees from within another worktree. Once work is complete, push the branch and open a PR via `gh pr create`.

### CLI changes workflow

When making changes to the CLI (`cli/` submodule) as part of feature work:

1. Make changes in `cli/` and commit + push to `cli` remote **first**
2. Update the control-plane's Go dependency: `cd control-plane && go get github.com/dazzle-labs/cli@<commit-hash>`
3. Verify it builds: `cd control-plane && go build ./...`
4. Back in the root repo, stage: `git add cli control-plane/go.mod control-plane/go.sum`
5. Commit the submodule bump + go.mod update along with any related root-repo changes (docs, k8s manifests, etc.)
6. Push the root repo

## CLI commands in the frontend

All `dazzle` commands shown in the web UI come from `web/src/lib/cli-commands.ts`. Never hardcode a CLI command string in a component — add or reuse an entry in the `cli` object and reference it. CI runs `make check-cli-commands` to validate every registered command against the real binary.

## llms.txt

Follows the [llms.txt spec](https://llmstxt.org/). Three files:

- **`/llms.txt`** — lean navigation index linking to guide.md and llms-full.txt. Edit `llms.txt.tmpl`.
- **`/llms-full.txt`** — complete reference (getting started, CLI help, content guide). Edit `llms-full.txt.tmpl`.
- **`/guide.md`** — detailed content authoring guide (GPU vs CPU tiers, performance, design tips). Edit `web/public/guide.md`.

Both `.tmpl` files use `{{ .CLIHelp }}` to embed live CLI help output. Run `make llms-txt` to regenerate from templates. CI verifies generation is clean.

## Proto / API types

Proto interfaces are split into public and internal:

- **Public** (`dazzle.v1`) — Stage, Runtime, Stream, User. Proto source + generated Go live in `cli/` (git submodule → `github.com/dazzle-labs/cli`). These are the client-facing APIs.
- **Internal** (`dazzle.internal.v1`) — ApiKey, Featured. Proto source in `control-plane/proto/api/v1/`, generated Go in `control-plane/internal/gen/`. Go's `internal/` directory enforces access restriction. FeaturedService is public (no auth interceptor). Both generate TypeScript into `web/src/gen/` via `protoc-gen-es`.

A `go.work` file at the repo root wires up `./control-plane`, `./cli`, and `./sidecar` so local builds always use the local submodule — no tagging needed during development.

### Changing public proto definitions

1. Edit the `.proto` files in `cli/proto/api/v1/`
2. Regenerate: `cd cli && make proto`
3. Build locally to verify: `cd control-plane && go build ./...` (go.work picks up local changes)
4. When ready to ship: commit + tag cli, then `cd control-plane && go get github.com/dazzle-labs/cli@<new-tag>`

### Changing internal proto definitions

1. Edit `control-plane/proto/api/v1/apikey.proto`
2. Regenerate: `cd control-plane/proto && buf generate`
3. Commit the updated files in `control-plane/internal/gen/`

### Changing sidecar proto definitions

1. Edit `sidecar/proto/api/v1/sidecar.proto`
2. Regenerate: `cd sidecar/proto && buf generate`
3. Commit the updated files in `sidecar/gen/api/v1/`
