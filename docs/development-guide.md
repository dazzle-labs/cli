# Development Guide

**Last updated:** 2026-03-09

---

## Prerequisites

- **Go** 1.25+ (control-plane, sidecar)
- **Node.js** 20+ (web)
- **Docker** (for Kind local cluster)
- **SOPS + Age** (secret management)
- **kubectl** (optional, direct k8s access)
- **buf** CLI (protobuf code generation, optional)

---

## Repository Layout

```
agent-streamer/
├── control-plane/      # Go backend (API, K8s orchestration, sidecar proxy)
│   ├── docker/         # Dockerfile for control-plane
│   ├── migrations/     # PostgreSQL .up.sql files
│   ├── proto/api/v1/   # Internal protobuf definitions (ApiKey)
│   └── internal/gen/   # Generated Go code (commit this)
├── cli/                # Git submodule — public proto definitions + generated Go
│   └── proto/api/v1/   # Public protobuf (Stage, Runtime, Stream, User)
├── stage-runtime/      # Infrastructure container (Chrome, Xvfb, PulseAudio)
├── sidecar/            # Go sidecar binary (sync, CDP, ffmpeg, R2)
├── web/                # React/TypeScript SPA
│   └── src/gen/api/v1/ # Generated TypeScript protobuf (commit this)
├── k8s/                # Kubernetes YAML manifests
│   ├── control-plane/  # Deployment, RBAC, service, oauth secrets
│   ├── infrastructure/ # PostgreSQL, encryption-key, postgres-auth secrets
│   ├── local/          # Kind cluster config, NodePort service, dev secrets
│   ├── networking/     # Traefik config, ClusterIssuer, Ingress
│   ├── clerk/          # Clerk auth secrets
│   ├── secrets/        # Docker Hub pull secret
│   └── hetzner/        # OpenTofu cluster provisioning (kube-hetzner)
├── .github/workflows/  # CI/CD pipeline
└── Makefile            # Build/deploy automation
```

---

## Local Development

### Full-Stack Local (Kind) — Recommended

The fastest way to develop locally is with Kind, which runs the entire stack (postgres, control-plane, streamer) in a local Kubernetes cluster.

```bash
make dev    # Builds everything, starts Kind cluster, runs web dev server + log tail
```

Or step by step:
```bash
make up     # Create Kind cluster, build images, deploy full stack
make web/dev  # Start web dev server (in another terminal)
```

See **[Local Development (Kind)](./local-dev.md)** for prerequisites, first-time setup, and the full workflow.

### Control Plane (Go) — Compile Check Only

```bash
cd control-plane
go build -o /dev/null .   # Compile check
go vet ./...              # Static analysis
```

The control-plane requires Kubernetes (`rest.InClusterConfig()`) and postgres to run. Use Kind for full local execution.

### Web Frontend (React)

```bash
cd web
npm install
npm run dev          # Vite dev server (proxies /api.v1, /cdp, /stage, /health to :8080)
npm run build        # Production build → web/dist/
```

The Vite dev proxy in `web/vite.config.ts` routes API paths to `http://localhost:8080` (either Kind or remote).

### Streamer

The streamer runs inside Docker/Kubernetes with Chrome, Xvfb, and PulseAudio. It contains no custom application code — all logic (including ffmpeg pipeline management) is in the sidecar. Use Kind to test changes.

### Sidecar

The sidecar runs alongside the streamer in each pod. Use Kind to test sidecar changes: `make build-sidecar`

---

## Build & Deploy

### Local Development (Kind)

```bash
make dev                     # Full local dev — build, deploy, watch everything
make up                      # Create Kind cluster, build images, deploy full stack
make down                    # Delete the Kind cluster
make build                   # Build all images and load into Kind
make build-cp                # Build control-plane image and load into Kind
make build-streamer          # Build streamer image and load into Kind
make deploy                  # Apply manifests and restart control-plane in Kind
make logs                    # Tail control-plane logs in Kind
make status                  # Show pods and services in Kind
make kubectx                 # Set kubectl context to Kind cluster (then just use kubectl directly)
make web/dev                 # Run web dev server only
```

### Remote (Production)

Remote builds and deploys are managed by **CI/CD** (GitHub Actions). Pushing to `main` triggers the pipeline which builds images, pushes to Docker Hub, and deploys to the Hetzner cluster.

```bash
make prod/status           # Show pods and services on prod cluster
```

### Typical Change Cycle

```bash
# Local development:
make dev                     # Start everything locally

# For targeted rebuilds during dev:
make build-cp deploy         # Rebuild control-plane + redeploy
make build-streamer deploy   # Rebuild streamer + redeploy

# Production: push to main, CI/CD handles the rest
```

---

## Protobuf Code Generation

Proto interfaces are split into **public** and **internal**:

- **Public** (`dazzle.v1`) — Stage, Runtime, Stream, User. Proto source + generated Go live in `cli/` (git submodule). These are the client-facing APIs.
- **Internal** (`dazzle.internal.v1`) — ApiKey. Proto source in `control-plane/proto/api/v1/`, generated Go in `control-plane/internal/gen/`.
- **Sidecar** — SyncService, RuntimeService, ObsService. Proto source in `sidecar/proto/api/v1/sidecar.proto`, generated Go in `sidecar/gen/api/v1/`. These are internal ConnectRPC services called by the control-plane. `go.work` includes `./sidecar` for local development.

```bash
make proto                   # Generate both Go + TypeScript (uses buf)
```

### Changing public proto definitions
1. Edit `.proto` files in `cli/proto/api/v1/`
2. Regenerate: `cd cli && make proto`
3. Build locally to verify: `cd control-plane && go build ./...` (go.work picks up local changes)
4. When ready to ship: commit + tag cli, then `cd control-plane && go get github.com/dazzle-labs/cli@<new-tag>`

### Changing internal proto definitions
1. Edit `control-plane/proto/api/v1/apikey.proto`
2. Regenerate: `cd control-plane/proto && buf generate`
3. Commit the updated files in `control-plane/internal/gen/`

> Generated files are committed to the repo. Only regenerate when `.proto` files change.

---

## Secret Management

Secrets are SOPS-encrypted using Age encryption (4 recipients). Recipients configured in `.sops.yaml`.

**Encrypted files:**

| File | Contains |
|------|----------|
| `k8s/clerk/clerk-auth.secrets.yaml` | `secret-key`, `publishable-key` |
| `k8s/infrastructure/encryption-key.secrets.yaml` | `key` (AES-256-GCM) |
| `k8s/infrastructure/postgres-auth.secrets.yaml` | `password` |
| `k8s/control-plane/oauth.secrets.yaml` | Twitch, Google, Kick OAuth credentials |
| `k8s/secrets/dockerhub-secret.yaml` | Docker Hub pull credentials |
| `k8s/networking/browserless-secret.yaml` | `token` (plaintext — not SOPS encrypted) |
| `k8s/local/local.secrets.yaml` | Combined local dev secrets |
| `k8s/hetzner/ssh_key.enc` | SSH private key for cluster nodes |
| `k8s/hetzner/kubeconfig.yaml.enc` | Remote cluster kubeconfig |

**Do not decrypt secrets to disk.** The Makefile, CI/CD pipeline, and OpenTofu all handle decryption automatically and transiently:
- `make up` / `make deploy` decrypts and applies local secrets
- CI/CD decrypts and applies production secrets on deploy
- `tofu plan`/`apply` decrypts SSH keys and kubeconfig via the SOPS provider
- `make prod/*` targets auto-decrypt the kubeconfig

To edit a secret value (decrypts in-memory, re-encrypts on save):
```bash
sops k8s/infrastructure/encryption-key.secrets.yaml
```

---

## Key Configuration Files

| File | Purpose |
|------|---------|
| `k8s/control-plane/deployment.yaml` | Control plane env vars, image, resource limits |
| `web/vite.config.ts` | Vite dev proxy config |
| `control-plane/proto/buf.gen.yaml` | buf codegen config (Go + TypeScript targets) |
| `.sops.yaml` | SOPS Age encryption recipients |
| `Makefile` | All build/deploy targets (local Kind + remote) |
| `k8s/hetzner/main.tf` | Cluster topology and provisioning |
| `.github/workflows/ci.yml` | CI/CD pipeline (build, push, deploy) |

---

## Monitoring

```bash
# Local (Kind)
make kubectx                 # Set kubectl context — then just use kubectl directly
make status                  # Show pods and services in Kind
make logs                    # Tail control-plane logs in Kind

# Remote (Hetzner)
make prod/status           # Show pods and services on prod cluster
```

---

## Testing

No automated test suite. Current validation approach:
- `go build -o /dev/null .` — compile check
- `go vet ./...` — static analysis
- Manual testing via web dashboard and API
- Root `package.json` has `playwright` for integration testing (not yet wired up)

---

## Infrastructure Provisioning

The Hetzner k3s cluster is provisioned via OpenTofu + the kube-hetzner module. See [Deployment Guide](./deployment-guide.md) and the [Hetzner Infrastructure Deep-Dive](./deep-dive-hetzner-k8s-infrastructure.md) for details.

```bash
make prod/infra/init              # Initialize OpenTofu providers
make prod/infra/plan              # Plan changes (decrypts/re-encrypts state automatically)
make prod/infra/apply             # Apply changes (decrypts/re-encrypts state automatically)
make prod/infra/output            # Show outputs
```

Terraform state is SOPS-encrypted in the repo. **Do not run `tofu` directly** — use the Make targets which handle state decryption/re-encryption so plaintext state is never left on disk.

> **No state locking.** Only one person should run infra commands at a time. Pull latest before running, and commit+push the updated `terraform.tfstate.enc` immediately after `infra/apply`.
