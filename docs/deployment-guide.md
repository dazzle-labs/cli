# Deployment Guide

**Last updated:** 2026-03-07

---

## Infrastructure Overview

- **Platform:** Hetzner Cloud k3s HA cluster (provisioned via OpenTofu + kube-hetzner)
- **Domain:** `stream.dazzle.fm`
- **Ingress:** Traefik (bundled with k3s)
- **TLS:** Let's Encrypt via cert-manager (HTTP01 challenge)
- **CI/CD:** GitHub Actions (build, push to Docker Hub, deploy)

### Cluster Topology

| Pool | Type | Server | Location | Count | Notes |
|------|------|--------|----------|-------|-------|
| cp-ash1/2/3 | Control Plane | cpx21 (3 vCPU / 4 GB) | ash | 3 | HA, backups enabled |
| worker-ash/2 | Agent | ccx43 (16 dedicated vCPU / 64 GB) | ash | 2 | Streamer workloads |
| autoscaled-workers | Autoscaler | ccx43 | ash | 0–3 | Burst capacity (~2 min cold start) |

---

## Architecture on k3s

```
Hetzner Load Balancer (lb11, ash)
    │
    v
Traefik Ingress (HTTPS :443)
    │  HTTP → HTTPS redirect
    │  TLS terminated (cert-manager + Let's Encrypt)
    │
    └── stream.dazzle.fm → control-plane:8080
                                │
                                ├── Web SPA (static files)
                                ├── ConnectRPC API (/api.v1.*)
                                ├── MCP Server (/stage/*/mcp/*)
                                ├── CDP Proxy (/stage/*/cdp)
                                ├── Stage HTTP/WS Proxy (/stage/*/...)
                                └── Creates → Streamer Pods (on-demand)
                                      ├── Init: restore from R2
                                      ├── Main: Chrome + OBS + ffmpeg + Node.js
                                      └── Sidecar: rclone sync to R2

PostgreSQL (StatefulSet, 5Gi PVC via Hetzner CSI)
```

---

## Kubernetes Resources

| Resource | Type | Namespace | Image |
|----------|------|-----------|-------|
| `control-plane` | Deployment (1 replica) | `browser-streamer` | `dazzlefm/agent-streamer-control-plane:<sha>` |
| `postgres` | StatefulSet (1 replica) | `browser-streamer` | `postgres:16-alpine` |
| `streamer-<id>` | Pod (ephemeral, per stage) | `browser-streamer` | `dazzlefm/agent-streamer-stage:<sha>` (main) + `dazzlefm/agent-streamer-sidecar:<sha>` (sidecar + init) |

Images are pulled from Docker Hub using `imagePullSecrets` (`dazzlefm-dockerhub-secret`). `imagePullPolicy: IfNotPresent`.

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

All production secrets are SOPS Age-encrypted (4 Age recipients):

| K8s Secret Name | Keys | Source File |
|-----------------|------|-------------|
| `clerk-auth` | `secret-key`, `publishable-key` | `k8s/clerk/clerk-auth.secrets.yaml` |
| `encryption-key` | `key` | `k8s/infrastructure/encryption-key.secrets.yaml` |
| `postgres-auth` | `password` | `k8s/infrastructure/postgres-auth.secrets.yaml` |
| `browserless-auth` | `token` | `k8s/networking/browserless-secret.yaml` (plaintext) |
| `oauth-platform` | `twitch-*`, `google-*`, `kick-*` | `k8s/control-plane/oauth.secrets.yaml` |
| `r2-credentials` | `endpoint`, `access_key_id`, `secret_access_key`, `bucket` | `k8s/secrets/r2-credentials.secrets.yaml` |
| `dazzlefm-dockerhub-secret` | `.dockerconfigjson` | `k8s/secrets/dockerhub-secret.yaml` |

Secrets are applied automatically — by CI/CD for production, and by `make up`/`make deploy` for local Kind. You generally do not need to decrypt secrets manually.

---

## RBAC

`control-plane` ServiceAccount has a namespaced Role with permissions:
- Resource `pods`: `create`, `delete`, `get`, `list`, `watch`

---

## CI/CD Pipeline

Images are built and deployed automatically by **GitHub Actions** on push to `main`.

### Pipeline Steps
1. Build `control-plane` image (includes `web/` SPA build)
2. Build `streamer` image
3. Build `sidecar` image
4. Push all three to Docker Hub (`dazzlefm/agent-streamer-control-plane`, `dazzlefm/agent-streamer-stage`, `dazzlefm/agent-streamer-sidecar`)
5. Compare image config digests — skip deploy if unchanged
6. Apply Kustomize manifests + SOPS-decrypted secrets
7. Update `STREAMER_IMAGE` and `SIDECAR_IMAGE` env vars via `kubectl set env`
8. Wait for rollout (300s timeout)
9. Post Discord notification

### Kustomize Resources Applied
1. `k8s/namespace.yaml`
2. `k8s/infrastructure/postgres.yaml`
3. `k8s/control-plane/rbac.yaml`
4. `k8s/control-plane/deployment.yaml` + `service.yaml`
5. `k8s/networking/ingress.yaml`
6. `k8s/networking/cluster-issuer.yaml`
7. `k8s/networking/traefik-config.yaml`

---

## Infrastructure Provisioning

The cluster is provisioned via OpenTofu + the kube-hetzner module. Configuration lives in `k8s/hetzner/`.

```bash
cd k8s/hetzner
cp terraform.tfvars.example terraform.tfvars   # Fill in hcloud_token
make prod/infra/init
make prod/infra/plan
make prod/infra/apply
```

Terraform state is SOPS-encrypted in the repo (`terraform.tfstate.enc`). The `infra/*` Make targets automatically decrypt before running and re-encrypt after — plaintext state is never left on disk.

> **No state locking.** Unlike a remote backend (S3, Consul), SOPS-encrypted state in git has no locking mechanism. Only one person should run `infra/plan` or `infra/apply` at a time. Always pull latest before running infra commands, and commit+push the updated `.enc` file immediately after `infra/apply`.

After provisioning, encrypt the kubeconfig for storage:
```bash
tofu output -raw kubeconfig | sops --encrypt --age "<recipients>" /dev/stdin > kubeconfig.yaml.enc
```

> **Avoid leaving decrypted secrets on disk.** The Makefile, CI/CD, and OpenTofu all handle decryption automatically and transiently. The `prod/*` Make targets decrypt the kubeconfig via process substitution — nothing is written to disk.

See [Hetzner k3s Infrastructure Deep-Dive](./deep-dive-hetzner-k8s-infrastructure.md) for full details.

---

## TLS Configuration

```yaml
Issuer: letsencrypt-prod (ClusterIssuer)
ACME: https://acme-v02.api.letsencrypt.org/directory
Email: admin@dazzle.fm
Challenge: HTTP01 via Traefik
Certificate Secret: stream-dazzle-fm-tls
```

Traefik is configured with HTTP → HTTPS redirect via `HelmChartConfig`.

cert-manager must be installed on the cluster. TLS certificates are automatically provisioned and renewed.

---

## Networking

| Service | Type | Port | Accessible |
|---------|------|------|------------|
| `control-plane` | ClusterIP | 8080 | Via Traefik ingress only |
| `postgres` | ClusterIP | 5432 | Internal only |
| Streamer pods | (no service) | 8080 | Via control-plane proxy (pod IP direct) |

Node-to-node traffic is encrypted via WireGuard.

---

## Monitoring

```bash
make prod/status               # Show pods, services on prod cluster
make prod/logs                 # Tail control-plane logs
```

Control-plane logs include:
- Pod creation/deletion events
- Authentication events (Clerk JWT and API key)
- MCP tool invocations
- Stage GC activity (pods stuck >3 min)
- DB migration status on startup
- Stage recovery on restart

---

## Adding a New Secret

1. Create `k8s/<category>/<name>.secrets.yaml` with the Secret manifest
2. Encrypt: `sops --encrypt --age "<recipients>" --encrypted-regex '^(stringData)$' --in-place <file>`
3. Add to `k8s/kustomization.yaml` resources (or update CI glob pattern)
4. Reference from `deployment.yaml` env vars
5. For local dev, add the secret to `k8s/local/local.secrets.yaml`

---

## PostgreSQL Notes

- Uses `PGDATA=/var/lib/postgresql/data/pgdata` — required for Hetzner volume compatibility (`lost+found` in mount root)
- PVC is `ReadWriteOnce` (5Gi) — postgres can only run on one node
- Storage provisioned via Hetzner CSI driver
