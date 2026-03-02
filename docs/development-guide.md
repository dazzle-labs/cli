# Development Guide

## Prerequisites

- **Go** 1.24+ (for session-manager)
- **Node.js** 20+ (for streamer server) / 24+ (for dashboard, per .nvmrc)
- **SSH access** to deployment host (for remote builds)
- **SOPS + Age** (for secret management)
- **kubectl** (optional, for direct k8s access)

## Repository Layout

```
browser-streamer/
├── session-manager/    # Go control plane
├── server/             # Node.js streamer pod
├── dashboard/          # React web app
├── docker/             # Container images
├── k8s/                # Kubernetes manifests
├── Makefile            # Build/deploy automation
└── provision.sh        # Infrastructure setup
```

## Local Development

### Session Manager (Go)

```bash
cd session-manager
go build -o /dev/null .   # Compile check
go vet ./...              # Lint
```

Environment variables needed for local run:
- `CLERK_SECRET_KEY` — Clerk secret key
- `ENCRYPTION_KEY` — 32-byte hex AES key
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` — PostgreSQL connection
- `PORT` — HTTP port (default: 8080)
- `NAMESPACE` — k8s namespace (default: browser-streamer)
- `STREAMER_IMAGE` — Streamer Docker image
- `MAX_SESSIONS` — Concurrent session limit (default: 3)

### Dashboard (React)

```bash
cd dashboard
npm install
npm run dev              # Starts Vite dev server with API proxy
npm run build            # Production build: tsc -b && vite build
```

The Vite dev server proxies `/api.v1`, `/cdp`, `/session`, `/health` to `http://localhost:8080` (session manager).

### Streamer Server (Node.js)

```bash
cd server
npm install
node index.js            # Requires Chrome + Xvfb running locally
```

Note: The streamer is designed to run inside a Docker container with Chrome, OBS, and Xvfb. Local development is limited without these dependencies.

## Build & Deploy

All builds happen remotely via SSH + BuildKit. No local Docker required.

### Build Commands

```bash
make build                  # Build both images on remote host
make build-streamer         # Build only streamer image
make build-session-manager  # Build only session-manager image (includes dashboard)
```

### Deploy Commands

```bash
make deploy                 # Apply k8s manifests + restart session-manager
make restart                # Restart session-manager (uses cached image)
```

### Typical Change Cycle

```bash
# Edit code locally
make build deploy           # Build + deploy in one step
make logs-sm                # Watch session-manager logs
make status                 # Verify pods are running
```

## Monitoring & Operations

```bash
make status                     # Pods + services
make logs-sm                    # Tail session-manager logs
make logs-session POD=<name>    # Tail a streamer pod
make sessions TOKEN=...         # List sessions via API
make create-session TOKEN=...   # Create a session via API
make clean                      # Delete all session pods
```

## Secret Management

Secrets are encrypted with SOPS using Age encryption (4 recipients configured in `.sops.yaml`).

Encrypted files in `k8s/`:
- `clerk-auth.secrets.yaml` — Clerk API keys
- `clerk-oauth.secrets.yaml` — OAuth client secret
- `encryption-key.secrets.yaml` — AES encryption key
- `postgres-auth.secrets.yaml` — Database password

To edit secrets:
```bash
sops k8s/<secret-file>.secrets.yaml
```

To deploy secrets:
```bash
sops -d k8s/<secret-file>.secrets.yaml | kubectl apply -f -
```

## Infrastructure Provisioning

For a fresh host:

```bash
make provision HOST=x.x.x.x TOKEN=<auth-token>
```

This installs k3s, cert-manager, builds images, deploys all services, and configures TLS.

## Protobuf Code Generation

Proto files are in `session-manager/proto/`. Generated code is in:
- `session-manager/gen/` (Go)
- `dashboard/src/gen/` (TypeScript)

To regenerate (requires `protoc`, `protoc-gen-go`, `protoc-gen-connect-go`, `protoc-gen-es`):
```bash
# Go
protoc --go_out=. --connect-go_out=. proto/*.proto

# TypeScript
npx buf generate
```

## Testing

No test suite exists yet. Current validation:
- `go build -o /dev/null .` — Compile check
- `go vet ./...` — Static analysis
- Manual testing via API and dashboard

## Key Configuration Files

| File | Purpose |
|------|---------|
| `k8s/session-manager-deployment.yaml` | Production env vars, resource limits |
| `dashboard/.env` | Clerk publishable key |
| `dashboard/vite.config.ts` | Dev server proxy config |
| `.sops.yaml` | Secret encryption recipients |
| `Makefile` | Build/deploy targets, HOST variable |
