# Deployment Guide

**Last updated:** 2026-03-03

---

## Infrastructure Overview

- **Platform:** Single VPS with k3s (lightweight Kubernetes, single-node)
- **Domain:** `stream.dazzle.fm`
- **Ingress:** Traefik (bundled with k3s)
- **TLS:** Let's Encrypt via cert-manager (HTTP01 challenge)

---

## Architecture on k3s

```
Traefik Ingress (HTTPS :443)
    │
    └── stream.dazzle.fm → control-plane:8080
                                │
                                ├── Web SPA (static files)
                                ├── ConnectRPC API (/api.v1.*)
                                ├── MCP Server (/stage/*/mcp/*)
                                ├── CDP Proxy (/cdp/*)
                                ├── Stage HTTP/WS Proxy (/stage/*/...)
                                └── Creates → Streamer Pods (on-demand)
                                      ├── Chrome + OBS on Xvfb
                                      ├── Vite HMR panel server
                                      └── Node.js Express API

PostgreSQL (StatefulSet, 5Gi PVC)
```

---

## Kubernetes Resources

| Resource | Type | Namespace | Image |
|----------|------|-----------|-------|
| `control-plane` | Deployment (1 replica) | `browser-streamer` | `control-plane:latest` |
| `postgres` | StatefulSet (1 replica) | `browser-streamer` | `postgres:16-alpine` |
| `streamer-<id>` | Pod (ephemeral, per stage) | `browser-streamer` | `browser-streamer:latest` |

---

## Resource Allocation

| Component | CPU Request | CPU Limit | RAM Request | RAM Limit |
|-----------|------------|-----------|-------------|-----------|
| control-plane | 100m | 500m | 128Mi | 256Mi |
| PostgreSQL | 100m | 500m | 256Mi | 512Mi |
| Streamer Pod | 2 | 4 | 4Gi | 8Gi |

Streamer pods also get a 2Gi `/dev/shm` volume (Chrome shared memory).

---

## Kubernetes Secrets

All production secrets are SOPS Age-encrypted:

| K8s Secret Name | Keys | Source File |
|-----------------|------|-------------|
| `clerk-auth` | `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY` | `k8s/clerk/clerk-auth.secrets.yaml` |
| `encryption-key` | `ENCRYPTION_KEY` | `k8s/infrastructure/encryption-key.secrets.yaml` |
| `postgres-auth` | `POSTGRES_PASSWORD` | `k8s/infrastructure/postgres-auth.secrets.yaml` |
| `browserless-auth` | `token` | `k8s/infrastructure/browserless-secret.yaml` |

```bash
make secrets           # Decrypt and apply all secrets
```

---

## RBAC

`control-plane` ServiceAccount has a namespaced Role with permissions:
- Resource `pods`: `create`, `delete`, `get`, `list`, `watch`

---

## Build Process

Images are built **remotely via SSH + BuildKit** (no local Docker required).

```bash
# Build all images
make build HOST=x.x.x.x

# Build individual images
make build-streamer HOST=x.x.x.x
make build-control-plane HOST=x.x.x.x CLERK_PK=pk_live_...
```

The control-plane build:
1. Runs `npm run build` inside `web/` (builds React SPA)
2. Copies `web/dist/` into the control-plane container at `/app/web/`
3. Go binary serves the SPA from `/app/web/`

Both images use `imagePullPolicy: Never` (pre-loaded into k3s containerd via `ctr images import`).

---

## Deployment Steps

### Quick Deploy (code changes)
```bash
make build deploy
```

### Full Deploy Breakdown
```bash
make build-streamer          # Build streamer image remotely
make build-control-plane     # Build control-plane + web SPA remotely
make deploy                  # Apply manifests + rollout restart
```

`make deploy` applies:
1. `k8s/infrastructure/postgres.yaml`
2. `k8s/control-plane/rbac.yaml`
3. `k8s/control-plane/deployment.yaml` + `service.yaml`
4. `k8s/networking/ingress.yaml`
5. Rollout restart `control-plane` deployment
6. Wait for rollout (60s timeout)

### Fresh Infrastructure Provisioning
```bash
make provision HOST=x.x.x.x TOKEN=<deploy-token>
```

Runs `provision.sh` via SSH:
1. Install k3s (single-node)
2. Create namespace `browser-streamer`
3. Apply secrets (`make secrets`)
4. Build + load images
5. Deploy control-plane + postgres
6. Install cert-manager
7. Apply Traefik config, ClusterIssuer, Ingress

---

## TLS Configuration

```yaml
Issuer: letsencrypt-prod (ClusterIssuer)
ACME: https://acme-v02.api.letsencrypt.org/directory
Email: admin@dazzle.fm
Challenge: HTTP01 via Traefik
Certificate Secret: stream-dazzle-fm-tls
```

Traefik is configured with HTTP → HTTPS redirect.

```bash
make install-cert-manager    # Install cert-manager CRDs + controller
make setup-tls               # Apply Traefik config, ClusterIssuer, Ingress
```

---

## Networking

| Service | Type | Port | Accessible |
|---------|------|------|------------|
| `control-plane` | ClusterIP | 8080 | Via Traefik ingress only |
| `postgres` | ClusterIP | 5432 | Internal only |
| Streamer pods | (no service) | 8080 | Via control-plane proxy (pod IP direct) |

---

## Monitoring

```bash
make status                  # Pods, services, ingress, TLS certificates
make logs-cp                 # Tail control-plane logs
make clean                   # Delete all stage pods
```

Control-plane logs include:
- Pod creation/deletion events
- Authentication events (Clerk JWT and API key)
- MCP tool invocations
- Stage GC activity (pods stuck >3 min)
- DB migration status on startup
- Stage recovery on restart
