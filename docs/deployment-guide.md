# Deployment Guide

## Infrastructure Overview

- **Platform:** Single VPS with k3s (lightweight Kubernetes)
- **Default Host:** 5.78.145.53 (Hetzner)
- **Domain:** stream.dazzle.fm
- **Ingress:** Traefik (bundled with k3s)
- **TLS:** Let's Encrypt via cert-manager (HTTP01 challenge)

## Architecture on k3s

```
Traefik Ingress (HTTPS :443)
    │
    └── stream.dazzle.fm → control-plane:8080
                                │
                                ├── Dashboard SPA (static files)
                                ├── ConnectRPC API
                                ├── MCP Server
                                ├── CDP Proxy
                                └── Creates → Streamer Pods
                                      ├── Chrome + OBS
                                      └── Node.js API

PostgreSQL (StatefulSet, 5Gi PVC)
Browserless Chromium Pool (HPA: 1-6 replicas)
```

## Kubernetes Resources

| Resource | Type | Namespace | Image |
|----------|------|-----------|-------|
| control-plane | Deployment (1 replica) | browser-streamer | control-plane:latest |
| browserless | Deployment (HPA 1-6) | browser-streamer | ghcr.io/browserless/chromium |
| postgres | StatefulSet (1 replica) | browser-streamer | postgres:16-alpine |
| streamer pods | Pod (ephemeral) | browser-streamer | browser-streamer:latest |

## Resource Allocation

| Component | CPU Request | CPU Limit | RAM Request | RAM Limit |
|-----------|------------|-----------|-------------|-----------|
| Session Manager | 100m | 500m | 128Mi | 256Mi |
| Browserless | 500m | 1 | 1Gi | 4Gi |
| PostgreSQL | 100m | 500m | 256Mi | 512Mi |
| Streamer Pod | 2 | 4 | 4Gi | 8Gi |

## Secrets

All production secrets are SOPS-encrypted with Age keys (4 recipients):

| Secret Name | Keys | Source |
|-------------|------|--------|
| `browserless-auth` | token | Plaintext in k8s manifest |
| `clerk-auth` | secret-key, publishable-key | SOPS encrypted |
| `clerk-oauth` | client-secret | SOPS encrypted |
| `encryption-key` | key | SOPS encrypted |
| `postgres-auth` | password | SOPS encrypted |

## RBAC

Session Manager ServiceAccount has a namespaced Role with permissions:
- `pods`: create, delete, get, list, watch

## Autoscaling

Browserless Chromium pool:
- Min: 1 replica
- Max: 6 replicas
- Target: 50% CPU utilization
- Scale up: +2 pods per 30s (immediate)
- Scale down: -1 pod per 60s (120s stabilization)

## Build Process

Images are built remotely via SSH + BuildKit (no local Docker needed):

```bash
# Streamer image
ssh root@HOST "buildctl build ..."
ssh root@HOST "k3s ctr images import /tmp/browser-streamer.tar"

# Session manager image (includes dashboard build)
ssh root@HOST "buildctl build --opt build-arg:VITE_CLERK_PUBLISHABLE_KEY=..."
ssh root@HOST "k3s ctr images import /tmp/control-plane.tar"
```

Both images use `imagePullPolicy: Never` (pre-loaded into containerd).

## Deployment Steps

### Quick Deploy (code changes)
```bash
make build deploy
```

### Full Deploy Breakdown
```bash
make build-streamer           # Build streamer image
make build-control-plane    # Build control-plane + dashboard
make deploy                   # Apply manifests + restart
```

`make deploy` runs:
1. Apply postgres.yaml
2. Apply control-plane RBAC
3. Apply control-plane deployment + service
4. Apply ingress
5. Rollout restart control-plane
6. Wait for ready (60s timeout)

### Fresh Infrastructure
```bash
make provision HOST=x.x.x.x TOKEN=<secret>
```

Provisions: k3s → namespace → secrets → browserless → images → control-plane → cert-manager → TLS

## Networking

| Service | Type | Port | External |
|---------|------|------|----------|
| control-plane | ClusterIP | 8080 | Via Traefik ingress |
| browserless | NodePort | 3000 → 30000 | Direct NodePort |
| postgres | ClusterIP | 5432 | Internal only |
| Streamer pods | ClusterIP | 8080 | Via control-plane proxy |

## TLS Configuration

- **Issuer:** letsencrypt-prod (ClusterIssuer)
- **ACME:** https://acme-v02.api.letsencrypt.org/directory
- **Email:** admin@dazzle.fm
- **Challenge:** HTTP01 via Traefik
- **Certificate:** `stream-dazzle-fm-tls` secret

Traefik configured with HTTP→HTTPS redirect.

## Monitoring

```bash
make status          # All resources
make logs-cp         # Control-plane logs
```

Session manager logs include:
- Pod creation/deletion events
- Authentication events
- MCP tool invocations
- GC activity (stuck sessions)
- Database migration status
