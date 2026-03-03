# Development Guide

**Last updated:** 2026-03-03

---

## Prerequisites

- **Go** 1.24+ (control-plane)
- **Node.js** 20+ (streamer), 20+ (web)
- **SSH access** to deployment host (remote builds)
- **SOPS + Age** (secret management)
- **kubectl** (optional, direct k8s access)
- **buf** CLI (protobuf code generation, optional)

---

## Repository Layout

```
browser-streamer/
├── control-plane/      # Go backend (API, K8s orchestration, CDP proxy, MCP)
│   ├── docker/         # Dockerfile for control-plane
│   ├── migrations/     # PostgreSQL .up.sql files
│   ├── proto/api/v1/   # Protobuf service definitions
│   └── gen/api/v1/     # Generated Go code (commit this)
├── streamer/           # Node.js browser pod service
│   └── docker/         # Dockerfile + entrypoint for streamer
├── web/                # React/TypeScript SPA
│   └── src/gen/api/v1/ # Generated TypeScript protobuf (commit this)
├── k8s/                # Kubernetes YAML manifests
│   ├── control-plane/  # Deployment, RBAC, service
│   ├── infrastructure/ # PostgreSQL, encryption-key, postgres-auth secrets
│   ├── networking/     # Traefik config, ClusterIssuer, Ingress
│   └── clerk/          # Clerk auth secrets
├── Makefile            # Build/deploy automation
└── provision.sh        # Full server provisioning script
```

---

## Local Development

### Control Plane (Go)

```bash
cd control-plane
go build -o /dev/null .   # Compile check
go vet ./...              # Static analysis
```

To run locally, the following env vars are required:

| Variable | Example | Description |
|----------|---------|-------------|
| `CLERK_SECRET_KEY` | `sk_test_...` | Clerk backend key |
| `ENCRYPTION_KEY` | `<64-hex-chars>` | 32-byte AES key |
| `DB_HOST` | `localhost` | PostgreSQL host |
| `DB_PORT` | `5432` | PostgreSQL port |
| `DB_USER` | `browser_streamer` | DB user |
| `DB_PASSWORD` | `<password>` | DB password |
| `DB_NAME` | `browser_streamer` | DB name |
| `PORT` | `8080` | Listen port |
| `NAMESPACE` | `browser-streamer` | Kubernetes namespace |
| `STREAMER_IMAGE` | `browser-streamer:latest` | Streamer pod image |
| `MAX_STAGES` | `3` | Max concurrent stages |

> Note: Running locally requires a Kubernetes context (in-cluster or kubeconfig). The control plane uses `rest.InClusterConfig()` and will fail without a valid k8s connection.

### Web Frontend (React)

```bash
cd web
npm install
npm run dev          # Vite dev server (proxies /api.v1, /cdp, /stage, /health to :8080)
npm run build        # Production build → web/dist/
```

The Vite dev proxy in `web/vite.config.ts` routes API paths to `http://localhost:8080`.

### Streamer (Node.js)

```bash
cd streamer
npm install
node index.js        # Requires Chrome + Xvfb running locally
```

> The streamer is designed for the Docker/Kubernetes environment with Chrome, OBS, and Xvfb. Local development without these is limited. The panel system (`/tmp/content/`) and Vite HMR dev server will start, but Chrome CDP will be unavailable.

---

## Build & Deploy

All Docker image builds happen remotely via SSH + BuildKit. No local Docker required.

### Build Commands

```bash
make build                   # Build all images (control-plane + streamer) on remote host
make build-streamer          # Build streamer image only
make build-control-plane     # Build control-plane image only (includes web SPA build)
```

The control-plane build automatically runs `npm run build` in `web/` and embeds the output into the Go server.

### Deploy Commands

```bash
make deploy                  # Apply k8s manifests + restart control-plane
make restart                 # Restart control-plane pod (picks up latest image)
```

### Typical Change Cycle

```bash
# For control-plane or web changes:
make build deploy            # Build remote + apply manifests

# For quick control-plane-only restart:
make restart

# Watch logs:
make logs-cp
make status
```

### Component-Level Targets

```bash
make control-plane/build     # Same as: cd control-plane && make build
make control-plane/deploy    # Same as: make deploy (limited to CP)
make control-plane/logs      # Tail control-plane logs
make streamer/build          # Build streamer image
make web/build               # Build React SPA
make web/dev                 # Start Vite dev server
```

---

## Protobuf Code Generation

Proto files: `control-plane/proto/api/v1/*.proto`

Generated output:
- Go: `control-plane/gen/api/v1/`
- TypeScript: `web/src/gen/api/v1/`

```bash
make proto                   # Generate both Go + TypeScript (uses buf)
```

Or manually:
```bash
cd control-plane
buf generate                 # Uses buf.gen.yaml config
```

> Generated files are committed to the repo. Only regenerate when `.proto` files change.

---

## Secret Management

Secrets are SOPS-encrypted using Age encryption. Recipients configured in `.sops.yaml`.

**Encrypted files:**

| File | Contains |
|------|----------|
| `k8s/clerk/clerk-auth.secrets.yaml` | `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` |
| `k8s/infrastructure/encryption-key.secrets.yaml` | `ENCRYPTION_KEY` (AES-256) |
| `k8s/infrastructure/postgres-auth.secrets.yaml` | `POSTGRES_PASSWORD` |
| `k8s/infrastructure/browserless-secret.yaml` | `POD_TOKEN` (internal auth) |

```bash
# Decrypt and apply all secrets
make secrets

# Edit a secret
sops k8s/infrastructure/encryption-key.secrets.yaml

# Decrypt manually
sops -d k8s/infrastructure/postgres-auth.secrets.yaml | kubectl apply -f -
```

---

## Key Configuration Files

| File | Purpose |
|------|---------|
| `k8s/control-plane/deployment.yaml` | Control plane env vars, image, resource limits |
| `web/vite.config.ts` | Vite dev proxy config |
| `control-plane/proto/buf.gen.yaml` | buf codegen config (Go + TypeScript targets) |
| `.sops.yaml` | SOPS Age encryption recipients |
| `Makefile` | All build/deploy targets; `HOST` variable for remote SSH |
| `provision.sh` | Full VPS provisioning (k3s, cert-manager, image builds, deploy) |

---

## Monitoring

```bash
make status                  # Show pods, services, ingress, certificates
make logs-cp                 # Tail control-plane logs
make clean                   # Delete all active stage pods
```

---

## Testing

No automated test suite. Current validation approach:
- `go build -o /dev/null .` — compile check
- `go vet ./...` — static analysis
- Manual testing via web dashboard and API
- Root `package.json` has `playwright` for integration testing (not yet wired up)

---

## Infrastructure Provisioning (Fresh Host)

```bash
make provision HOST=x.x.x.x TOKEN=<deploy-token>
```

Runs `provision.sh` via SSH, which:
1. Installs k3s (single-node)
2. Installs cert-manager
3. Builds all Docker images
4. Deploys all k8s manifests
5. Configures Traefik TLS + Let's Encrypt
