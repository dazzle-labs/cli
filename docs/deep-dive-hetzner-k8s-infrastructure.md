# Hetzner k3s Infrastructure & Kubernetes Manifests - Deep Dive Documentation

**Generated:** 2026-03-07
**Scope:** `k8s/hetzner/` + `k8s/`
**Files Analyzed:** 28
**Lines of Code:** ~650 (user-authored, excluding vendor/SOPS blocks)
**Workflow Mode:** Exhaustive Deep-Dive

## Overview

This deep-dive covers the Hetzner Cloud k3s cluster provisioning (via the kube-hetzner Terraform module) and the Kubernetes manifests that deploy the browser-streamer application onto it. This is a **significant infrastructure upgrade** from the previous single-VPS setup — the cluster now has 3 HA control-plane nodes, 2 dedicated worker nodes, and an autoscaler pool (0–3 burst nodes).

**Purpose:** Provision and manage a production-grade multi-node k3s cluster on Hetzner Cloud, deploy the browser-streamer stack (control-plane, PostgreSQL, networking/TLS), and provide operational tooling for remote cluster management.

**Key Responsibilities:**
- Cluster provisioning via OpenTofu + kube-hetzner module
- Secret management (SOPS + Age encryption for kubeconfig, SSH keys, app secrets)
- Application deployment (Kustomize-based manifests)
- TLS termination (Traefik + cert-manager + Let's Encrypt)
- CI/CD deployment pipeline (GitHub Actions)

**Integration Points:** CI/CD pipeline deploys images to this cluster; control-plane uses RBAC to spawn streamer pods; Traefik routes external traffic to control-plane which proxies to streamer pods.

---

## Complete File Inventory

### k8s/hetzner/main.tf

**Purpose:** Core Terraform configuration — instantiates the `kube-hetzner/kube-hetzner/hcloud` module with the full cluster topology. This is the single source of truth for cluster shape.
**Lines of Code:** 118
**File Type:** Terraform (HCL)

**What Future Contributors Must Know:** This defines the entire cluster topology. Changing node counts, server types, or adding node pools happens here. The autoscaler pool (`autoscaled-workers`) scales from 0 to 3 nodes automatically via the Kubernetes cluster autoscaler. All nodes are in the `ash` (Ashburn, Virginia) location.

**Key Resources Defined:**
- `locals` block — resolves `hcloud_token` from var, `ssh_private_key` from SOPS-encrypted file
- `data "sops_file" "ssh_key"` — decrypts `ssh_key.enc` at plan/apply time
- `module "kube-hetzner"` — the main cluster module

**Cluster Topology:**
| Pool | Type | Server | Location | Count | Notes |
|------|------|--------|----------|-------|-------|
| cp-ash1 | Control Plane | cpx21 (3 vCPU / 4 GB) | ash | 1 | Backups enabled |
| cp-ash2 | Control Plane | cpx21 | ash | 1 | Backups enabled |
| cp-ash3 | Control Plane | cpx21 | ash | 1 | Backups enabled |
| worker-ash | Agent | ccx43 (16 dedicated vCPU / 64 GB) | ash | 1 | |
| worker-ash2 | Agent | ccx43 | ash | 1 | |
| autoscaled-workers | Autoscaler | ccx43 | ash | 0–3 | Burst capacity |

**Infrastructure Features:**
- Load Balancer: `lb11` in `ash`
- Ingress: Traefik (built-in k3s)
- Networking: WireGuard enabled for node-to-node encryption
- Storage: Hetzner CSI (default; Longhorn commented out)
- DNS: Cloudflare (1.1.1.1) + Google (8.8.8.8) + Cloudflare IPv6
- CCM: Helm-based (recommended for new installs)
- K3s channel: `stable`, auto-upgrade disabled
- Scheduling on control plane: disabled

**Dependencies:**
- `var.hcloud_token` — Hetzner API token
- `var.network_region`, `var.control_plane_server_type`, `var.agent_server_type`
- `ssh_key.enc` (SOPS-encrypted private key)
- `ssh_key.pub` (public key)

**Used By:**
- `outputs.tf` (reads `module.kube-hetzner.kubeconfig`)
- CI/CD pipeline (consumes the kubeconfig)
- Makefile `prod/*` targets (via decrypted kubeconfig)

---

### k8s/hetzner/variables.tf

**Purpose:** Declares all input variables for the Hetzner Terraform configuration with sensible defaults.
**Lines of Code:** 24
**File Type:** Terraform (HCL)

**What Future Contributors Must Know:** Server type defaults are tuned for this workload. Control plane nodes are lightweight (cpx21 — shared vCPU), while workers are beefy dedicated-CPU instances (ccx43) because streamer pods need significant CPU/RAM for Chrome + OBS.

**Variables:**
- `hcloud_token` (string, sensitive) — Hetzner Cloud API token (read/write)
- `network_region` (string, default: `"us-east"`) — Hetzner network region
- `control_plane_server_type` (string, default: `"cpx21"`) — 3 vCPU / 4 GB shared
- `agent_server_type` (string, default: `"ccx43"`) — 16 dedicated vCPU / 64 GB RAM

---

### k8s/hetzner/outputs.tf

**Purpose:** Exposes the cluster kubeconfig as a Terraform output so it can be extracted after provisioning.
**Lines of Code:** 10
**File Type:** Terraform (HCL)

**What Future Contributors Must Know:** Run `tofu output -raw kubeconfig > kubeconfig.yaml` to extract. The output is marked `sensitive = true`. The encrypted version (`kubeconfig.yaml.enc`) should be committed; the plaintext (`kubeconfig.yaml`) is gitignored.

**Outputs:**
- `kubeconfig` (sensitive) — raw kubeconfig from the kube-hetzner module
- `kubeconfig_file` — helper string reminding you of the extraction command

---

### k8s/hetzner/providers.tf

**Purpose:** Declares required Terraform/OpenTofu version and provider dependencies.
**Lines of Code:** 20
**File Type:** Terraform (HCL)

**What Future Contributors Must Know:** Uses OpenTofu (not HashiCorp Terraform) — the `required_version >= 1.5.0` is compatible with both, but the project uses `tofu` commands. The SOPS provider (`carlpett/sops`) enables decrypting Age-encrypted files inline during plan/apply.

**Providers:**
- `hcloud` (hetznercloud/hcloud >= 1.43.0) — Hetzner Cloud resources
- `sops` (carlpett/sops >= 0.7.0) — SOPS decryption in Terraform

---

### k8s/hetzner/terraform.tfvars

**Purpose:** Actual variable values used for provisioning. Contains the live Hetzner API token.
**Lines of Code:** 14
**File Type:** Terraform vars

**What Future Contributors Must Know:** This file is **gitignored** (see `.gitignore`). It contains the real `hcloud_token`. Copy from `terraform.tfvars.example` on a fresh checkout. SSH keys are managed via SOPS, not via this file.

---

### k8s/hetzner/terraform.tfvars.example

**Purpose:** Template showing required variables with empty/example values for new contributors.
**Lines of Code:** 11
**File Type:** Terraform vars (template)

**What Future Contributors Must Know:** This IS committed to git. Copy to `terraform.tfvars` and fill in the `hcloud_token`. SSH keys and server types have defaults; only the token is required.

---

### k8s/hetzner/.gitignore

**Purpose:** Controls which files are committed vs gitignored in the infra directory.
**Lines of Code:** 11
**File Type:** gitignore

**Key Decisions:**
- **Gitignored:** `terraform.tfvars`, `*.tfstate`, `*.tfstate.backup`, `.terraform/`, `.terraform.lock.hcl`, `kubeconfig.yaml`, `k3s_kubeconfig.yaml`, `k3s_kustomization_backup.yaml`, `ssh_key` (private, plaintext)
- **Committed (via `!` negation):** `ssh_key.pub`, `ssh_key.enc` (SOPS-encrypted private key), `kubeconfig.yaml.enc` (SOPS-encrypted kubeconfig)

---

### k8s/hetzner/ssh_key.pub

**Purpose:** ED25519 public SSH key used by kube-hetzner to provision nodes.
**Lines of Code:** 1
**File Type:** SSH public key

**What Future Contributors Must Know:** Paired with `ssh_key.enc` (the SOPS-encrypted private key). The kube-hetzner module injects this into all nodes for SSH access. Key comment is `kube-hetzner`.

---

### k8s/hetzner/ssh_key.enc

**Purpose:** SOPS Age-encrypted ED25519 private SSH key for node access.
**File Type:** SOPS-encrypted file (raw input type)

**What Future Contributors Must Know:** Decrypted at Terraform plan/apply time via the `sops_file` data source. Requires an Age key in `~/.config/sops/age/keys.txt` matching one of the recipients.

---

### k8s/hetzner/kubeconfig.yaml.enc

**Purpose:** SOPS Age-encrypted kubeconfig for the remote Hetzner cluster.
**File Type:** SOPS-encrypted YAML

**What Future Contributors Must Know:** Do not decrypt this to disk. The Makefile's `prod/*` targets decrypt it transiently via process substitution. Use `make prod/kubectl ARGS="..."` to run commands against the remote cluster.

---

### k8s/kustomization.yaml

**Purpose:** Root Kustomization that assembles all production Kubernetes resources.
**Lines of Code:** 13
**File Type:** Kustomize config

**What Future Contributors Must Know:** This is the canonical list of what gets deployed. Secrets are NOT in this file — they are applied separately via CI/CD (`sops --decrypt | kubectl apply`). The local Kind overlay uses a different deployment path (Makefile applies resources individually).

**Resources included:**
1. `namespace.yaml`
2. `infrastructure/postgres.yaml`
3. `control-plane/rbac.yaml`
4. `control-plane/deployment.yaml`
5. `control-plane/service.yaml`
6. `networking/ingress.yaml`
7. `networking/cluster-issuer.yaml`
8. `networking/traefik-config.yaml`

---

### k8s/namespace.yaml

**Purpose:** Creates the `browser-streamer` namespace where all application resources live.
**Lines of Code:** 4
**File Type:** Kubernetes manifest

---

### k8s/control-plane/deployment.yaml

**Purpose:** Defines the control-plane Deployment — the central Go binary that serves the API, web SPA, and orchestrates streamer pods.
**Lines of Code:** 121
**File Type:** Kubernetes manifest

**What Future Contributors Must Know:** This is the most complex manifest. It wires up 14 environment variables from 5 different Secrets plus hardcoded values. The `STREAMER_IMAGE` env var controls which image newly spawned streamer pods use — CI/CD updates this via `kubectl set env`. OAuth secrets are marked `optional: true` so the pod starts even if those secrets are missing.

**Key Configuration:**
- Image: `dazzlefm/agent-streamer-control-plane:main`
- Port: 8080
- ServiceAccount: `control-plane` (has pod CRUD permissions)
- ImagePullSecrets: `dazzlefm-dockerhub-secret`
- Resources: 100m–500m CPU, 128Mi–256Mi RAM
- Health checks: `/health` endpoint (readiness: 2s init, liveness: 5s init)
- `OAUTH_REDIRECT_BASE_URL`: `https://stream.dazzle.fm`
- `MAX_SESSIONS`: 3

**Environment Variables from Secrets:**
| Env Var | Secret | Key |
|---------|--------|-----|
| `POD_TOKEN` | `browserless-auth` | `token` |
| `CLERK_SECRET_KEY` | `clerk-auth` | `secret-key` |
| `ENCRYPTION_KEY` | `encryption-key` | `key` |
| `DB_PASSWORD` | `postgres-auth` | `password` |
| `TWITCH_CLIENT_ID` | `oauth-platform` | `twitch-client-id` |
| `TWITCH_CLIENT_SECRET` | `oauth-platform` | `twitch-client-secret` |
| `GOOGLE_CLIENT_ID` | `oauth-platform` | `google-client-id` |
| `GOOGLE_CLIENT_SECRET` | `oauth-platform` | `google-client-secret` |
| `KICK_CLIENT_ID` | `oauth-platform` | `kick-client-id` |
| `KICK_CLIENT_SECRET` | `oauth-platform` | `kick-client-secret` |

---

### k8s/control-plane/service.yaml

**Purpose:** ClusterIP service exposing the control-plane on port 8080 within the cluster. Traefik Ingress routes external traffic here.
**Lines of Code:** 13
**File Type:** Kubernetes manifest

---

### k8s/control-plane/rbac.yaml

**Purpose:** ServiceAccount + Role + RoleBinding giving the control-plane pod permission to manage streamer pods.
**Lines of Code:** 30
**File Type:** Kubernetes manifest

**What Future Contributors Must Know:** The Role is namespace-scoped to `browser-streamer`. Permissions are minimal: only `pods` resource with `create`, `delete`, `get`, `list`, `watch`. If the control-plane needs to manage other resource types (e.g., Services, ConfigMaps), this Role must be updated.

---

### k8s/control-plane/oauth.secrets.yaml

**Purpose:** SOPS-encrypted OAuth credentials for Twitch, Google, and Kick platform integrations.
**Lines of Code:** 55 (mostly SOPS metadata)
**File Type:** SOPS-encrypted Kubernetes Secret

**What Future Contributors Must Know:** Encrypted with 4 Age recipients (multi-key). Contains 6 keys: `twitch-client-id`, `twitch-client-secret`, `google-client-id`, `google-client-secret`, `kick-client-id`, `kick-client-secret`. Regex `^(stringData)$` ensures only the data section is encrypted.

---

### k8s/infrastructure/postgres.yaml

**Purpose:** Complete PostgreSQL deployment: PVC (5Gi), StatefulSet, and Service.
**Lines of Code:** 76
**File Type:** Kubernetes manifest

**What Future Contributors Must Know:** Uses `PGDATA=/var/lib/postgresql/data/pgdata` — this is required for Hetzner volume compatibility (the volume mount root has a `lost+found` directory that PostgreSQL rejects). The PVC uses `ReadWriteOnce` — this means postgres can only run on one node. Resources: 100m–500m CPU, 256Mi–512Mi RAM.

**Components:**
- PersistentVolumeClaim `postgres-data` (5Gi, RWO)
- StatefulSet `postgres` (1 replica, postgres:16-alpine)
- Service `postgres` (ClusterIP, port 5432)

---

### k8s/infrastructure/postgres-auth.secrets.yaml

**Purpose:** SOPS-encrypted PostgreSQL password.
**File Type:** SOPS-encrypted Kubernetes Secret
**Secret name:** `postgres-auth`, key: `password`

---

### k8s/infrastructure/encryption-key.secrets.yaml

**Purpose:** SOPS-encrypted application-level encryption key (used for AES-256-GCM encryption of stream keys in the database).
**File Type:** SOPS-encrypted Kubernetes Secret
**Secret name:** `encryption-key`, key: `key`

---

### k8s/networking/ingress.yaml

**Purpose:** Traefik Ingress routing `stream.dazzle.fm` to the control-plane service.
**Lines of Code:** 25
**File Type:** Kubernetes manifest

**What Future Contributors Must Know:** Uses `cert-manager.io/cluster-issuer: letsencrypt-prod` annotation for automatic TLS. The TLS secret is `stream-dazzle-fm-tls`. All paths (`/`) route to `control-plane:8080`. Adding new hosts or path-based routing happens here.

---

### k8s/networking/cluster-issuer.yaml

**Purpose:** Let's Encrypt production ClusterIssuer for automatic TLS certificate provisioning.
**Lines of Code:** 14
**File Type:** Kubernetes manifest

**What Future Contributors Must Know:** Uses HTTP01 challenge via Traefik ingress class. Email: `admin@dazzle.fm`. The private key is stored in secret `letsencrypt-prod-account-key`. Cert-manager must be installed on the cluster for this to work.

---

### k8s/networking/traefik-config.yaml

**Purpose:** Configures Traefik (via HelmChartConfig) to redirect HTTP to HTTPS.
**Lines of Code:** 11
**File Type:** Kubernetes manifest (HelmChartConfig)

**What Future Contributors Must Know:** This uses k3s's built-in `helm.cattle.io/v1` HelmChartConfig CRD to patch the Traefik Helm values. The `redirectTo.port: websecure` ensures all HTTP traffic on port 80 gets a 301 to HTTPS on port 443.

---

### k8s/networking/browserless-secret.yaml

**Purpose:** Browserless authentication token (used by control-plane for the POD_TOKEN env var).
**Lines of Code:** 9
**File Type:** Kubernetes Secret (plaintext — NOT SOPS encrypted)

**What Future Contributors Must Know:** This is the only secret that is NOT SOPS-encrypted. It's a hex token. Consider migrating to SOPS for consistency.

---

### k8s/clerk/clerk-auth.secrets.yaml

**Purpose:** SOPS-encrypted Clerk authentication keys (secret-key and publishable-key).
**File Type:** SOPS-encrypted Kubernetes Secret
**Secret name:** `clerk-auth`, keys: `secret-key`, `publishable-key`

---

### k8s/secrets/dockerhub-secret.yaml

**Purpose:** SOPS-encrypted Docker Hub pull secret for pulling private images.
**File Type:** SOPS-encrypted Kubernetes Secret (type: `kubernetes.io/dockerconfigjson`)
**Secret name:** `dazzlefm-dockerhub-secret`

**What Future Contributors Must Know:** Uses `encrypted_regex: ^(data|stringData)$` (note: includes `data` unlike other secrets). Referenced by the control-plane Deployment's `imagePullSecrets`.

---

### k8s/local/kind-config.yaml

**Purpose:** Kind cluster configuration for local development — maps container port 30080 to host port 8080.
**Lines of Code:** 10
**File Type:** Kind config

---

### k8s/local/service.yaml

**Purpose:** NodePort service override for local Kind development — exposes control-plane on nodePort 30080.
**Lines of Code:** 14
**File Type:** Kubernetes manifest

**What Future Contributors Must Know:** The nodePort 30080 must match the `containerPort` in `kind-config.yaml`. This replaces the production ClusterIP service when running locally.

---

### k8s/local/local.secrets.yaml

**Purpose:** SOPS-encrypted secrets for local development — contains postgres-auth, clerk-auth, encryption-key, and browserless-auth all in one file.
**Lines of Code:** 204 (mostly SOPS metadata for 4 secret documents)
**File Type:** SOPS-encrypted multi-document Kubernetes manifest

**What Future Contributors Must Know:** This is a multi-document YAML (`---` separated) containing 4 secrets. The local secrets may have different values from production (e.g., different Clerk keys for dev environment).

---

## Contributor Checklist

**Risks & Gotchas:**
- `terraform.tfvars` contains the live Hetzner API token — never commit it (gitignored)
- `browserless-secret.yaml` is the only plaintext secret — all others use SOPS
- SOPS secrets require an Age key matching one of the 4 recipients
- The `PGDATA` env var in postgres.yaml is critical for Hetzner volume compatibility — do not remove
- Autoscaler pool min=0 means burst nodes will be cold-started on demand (takes ~2 min)
- `imagePullPolicy: IfNotPresent` in the deployment means tag-based updates (e.g., `:main`) won't pull new images unless the pod is recreated or the tag changes — CI/CD handles this with digest comparison
- The kube-hetzner module is vendored in `.terraform/modules/` — `tofu init` downloads it

**Pre-change Verification Steps:**
1. `tofu plan` before any infra changes — review the diff carefully
2. `make prod/status` to verify cluster health before deploying
3. Check `kubectl get pvc -n browser-streamer` to ensure postgres volume is bound before restarting postgres
4. Verify SOPS decryption works: `sops -d k8s/hetzner/kubeconfig.yaml.enc | head -5`

**Suggested Tests Before PR:**
- `tofu validate` in `k8s/hetzner/`
- `kubectl apply --dry-run=client -f k8s/` for manifest syntax
- `make prod/status` after deploying to verify pods are Running

---

## Architecture & Design Patterns

### Code Organization

The infrastructure is split into two layers:

1. **Provisioning layer** (`k8s/hetzner/`) — OpenTofu/Terraform manages cloud resources (servers, networking, load balancer, k3s installation). This runs once to create the cluster, then occasionally for topology changes.

2. **Application layer** (`k8s/`) — Kustomize-organized Kubernetes manifests define the application workload. These are applied by CI/CD on every push to `main`, or manually via `make deploy`.

Secrets are orthogonal to both layers — SOPS-encrypted at rest, decrypted at apply time.

### Design Patterns

- **Infrastructure as Code (IaC):** Entire cluster defined in Terraform/HCL, reproducible from scratch
- **Module Composition:** Uses the community `kube-hetzner` module rather than raw Hetzner resources — abstracts k3s installation, networking, cloud-init, etc.
- **Secret Envelope Encryption:** All sensitive data encrypted with Age (SOPS) before committing. 4 Age recipients allow multiple team members/CI to decrypt.
- **Kustomize Base + Overlays:** `k8s/kustomization.yaml` is the production base; `k8s/local/` provides Kind-specific overrides
- **CI/CD Digest Comparison:** The deploy pipeline compares image config digests (not just tags) to avoid unnecessary rollouts

### Secrets Management Strategy

All secrets use **SOPS with Age encryption**. There are 4 Age recipients across all encrypted files, suggesting:
- 1 personal key (developer)
- 1 CI/CD key (GitHub Actions has `AGE_SECRET_KEY` secret)
- 2 additional keys (backup/other team members)

**Secret categories:**
| Category | Files | Applied By |
|----------|-------|------------|
| Infra secrets | `ssh_key.enc`, `kubeconfig.yaml.enc` | Terraform / Makefile |
| App secrets (prod) | `k8s/*/*.secrets.yaml`, `k8s/secrets/*.yaml` | CI/CD pipeline |
| App secrets (local) | `k8s/local/local.secrets.yaml` | `make deploy` (local) |
| Plaintext exception | `k8s/networking/browserless-secret.yaml` | Kustomize / manual |

### Error Handling Philosophy

Infrastructure is designed for resilience:
- 3 control-plane nodes for HA (etcd quorum survives 1 node failure)
- Autoscaler pool (0–3) handles burst workloads
- Readiness/liveness probes on control-plane and postgres prevent traffic to unhealthy pods
- CI/CD waits for rollout success (300s timeout) before marking deploy complete

---

## Data Flow

```
Internet
    |
    v
Hetzner Load Balancer (lb11, ash)
    |
    v
Traefik Ingress (k3s built-in, HTTPS :443)
    |  HTTP -> HTTPS redirect (traefik-config.yaml)
    |  TLS terminated (cert-manager + Let's Encrypt)
    |
    v
control-plane Service (ClusterIP :8080)
    |
    v
control-plane Pod
    |-- Serves web SPA
    |-- ConnectRPC API
    |-- Creates/manages streamer pods (via K8s API, RBAC)
    |-- Proxies to streamer pods (CDP, MCP, HTTP, WS)
    |
    +-> PostgreSQL Service (ClusterIP :5432)
         |
         v
    PostgreSQL StatefulSet (PVC: 5Gi via Hetzner CSI)
```

### Data Entry Points
- **External HTTPS** — All user traffic enters via Hetzner LB -> Traefik -> Ingress -> control-plane
- **CI/CD** — GitHub Actions authenticates to cluster via `K3S_KUBECONFIG` secret, applies manifests and updates images
- **Developer CLI** — `make prod/*` targets use SOPS-decrypted kubeconfig for ad-hoc cluster access

### Data Transformations
- **SOPS Decryption** — Encrypted secrets are decrypted at apply time (CI: `sops --decrypt | kubectl apply`, local: Age key in `~/.config/sops/age/`)
- **Image Tag Resolution** — CI compares config digests between running and newly-built images to decide whether to deploy
- **Terraform State** — Cluster topology is tracked in `terraform.tfstate` (gitignored, stored locally)

### Data Exit Points
- **Streamer pod output** — OBS streams to external platforms (Twitch, YouTube, Kick) from within streamer pods
- **Discord notifications** — CI/CD posts deploy notifications via Discord webhook
- **Git tags** — CI force-pushes `deployed` tag to track last successful deploy

---

## Integration Points

### Hetzner Cloud API
- **Consumed by:** Terraform/OpenTofu via hcloud provider
- **Authentication:** `hcloud_token` (API token with read/write)
- **Resources managed:** Servers, networks, load balancers, SSH keys, placement groups, firewalls

### Kubernetes API (Remote)
- **Consumed by:** CI/CD pipeline, Makefile `prod/*` targets
- **Authentication:** Kubeconfig (stored as GitHub secret `K3S_KUBECONFIG` and SOPS-encrypted in repo)
- **Operations:** Deploy manifests, set env vars, check rollout status, decrypt/apply secrets

### Docker Hub Registry
- **Consumed by:** CI/CD (push images), Kubernetes (pull images)
- **Authentication:** `dazzlefm-dockerhub-secret` (imagePullSecrets)
- **Images:** `dazzlefm/agent-streamer-control-plane`, `dazzlefm/agent-streamer-stage`

### Let's Encrypt ACME
- **Consumed by:** cert-manager ClusterIssuer
- **Authentication:** HTTP01 challenge via Traefik
- **Output:** TLS certificate stored in `stream-dazzle-fm-tls` secret

### SOPS / Age
- **Used by:** Terraform (ssh_key.enc), Makefile (kubeconfig.yaml.enc), CI/CD (all .secrets.yaml files)
- **Recipients:** 4 Age public keys across all encrypted files

---

## Dependency Graph

```
k8s/hetzner/
  providers.tf ─────> (hcloud, sops providers)
  variables.tf ─────> main.tf
  main.tf ──────────> outputs.tf
    ├── ssh_key.pub
    ├── ssh_key.enc (via sops_file data source)
    └── module "kube-hetzner" (vendor: .terraform/modules/kube-hetzner/)

k8s/
  kustomization.yaml
    ├── namespace.yaml
    ├── infrastructure/postgres.yaml
    │     └── (needs) postgres-auth.secrets.yaml  [applied separately]
    ├── control-plane/rbac.yaml
    ├── control-plane/deployment.yaml
    │     └── (needs) clerk-auth, encryption-key, postgres-auth,
    │                  browserless-auth, oauth-platform, dockerhub-secret
    ├── control-plane/service.yaml
    ├── networking/ingress.yaml
    │     └── (needs) cluster-issuer.yaml, cert-manager CRDs
    ├── networking/cluster-issuer.yaml
    │     └── (needs) cert-manager installed
    └── networking/traefik-config.yaml
          └── (needs) k3s Traefik HelmChart CRD

  local/ (Kind overlay, not in kustomization.yaml)
    ├── kind-config.yaml
    ├── service.yaml (NodePort override)
    └── local.secrets.yaml (combined local secrets)
```

### Entry Points (Not Imported by Others in Scope)
- `k8s/hetzner/providers.tf` — Terraform entry point
- `k8s/kustomization.yaml` — Kustomize entry point
- `k8s/local/kind-config.yaml` — Kind entry point

### Leaf Nodes (Don't Import Others in Scope)
- `k8s/hetzner/outputs.tf`
- `k8s/namespace.yaml`
- `k8s/networking/traefik-config.yaml`
- `k8s/networking/browserless-secret.yaml`
- All `.secrets.yaml` files

### Circular Dependencies
No circular dependencies detected.

---

## Testing Analysis

### Test Coverage Summary
No automated tests exist for the infrastructure layer. This is typical for Terraform + Kubernetes manifests.

### Testing Gaps
- No `tofu validate` or `tofu plan` in CI
- No Kubernetes manifest validation (e.g., `kubeval`, `kubeconform`) in CI
- No integration tests for secret decryption
- The deploy pipeline does have rollout status checks (300s timeout) as a smoke test

---

## Related Code & Reuse Opportunities

### Similar Features Elsewhere
- **Makefile local targets** (`make up`, `make deploy`, `make build`) — the local Kind workflow mirrors the remote deployment but with local image builds instead of Docker Hub
- **CI/CD pipeline** (`.github/workflows/ci.yml`) — the deploy job is the automated version of `make prod/status` + `kubectl apply`

### Patterns to Follow
- **SOPS encryption pattern:** All new secrets should use Age encryption with the same 4 recipients. Use `sops --encrypt --age <recipients> --encrypted-regex '^(stringData)$'` for new Kubernetes secrets.
- **Makefile prod targets:** New cluster operations should follow the `prod/<name>` pattern in the Makefile, using the `$(RKCTL)` variable which decrypts the kubeconfig transiently.

---

## Implementation Notes

### Outdated Documentation
The existing `docs/deployment-guide.md` and `docs/index.md` still reference the **old single-VPS setup**:
- `index.md` says "Single Hetzner VPS, k3s (single-node Kubernetes)" — this is now a **multi-node HA cluster**
- `deployment-guide.md` describes SSH-based remote builds (`make build HOST=x.x.x.x`) and `make provision HOST=x.x.x.x` — these are superseded by CI/CD + Terraform provisioning
- `deployment-guide.md` says `imagePullPolicy: Never` with `ctr images import` — now uses Docker Hub registry with `imagePullPolicy: IfNotPresent`

These docs should be updated to reflect the new architecture.

### TODOs and Future Work
- `main.tf:102` — Longhorn commented out: `# enable_longhorn = true` — consider enabling for replicated storage if needed
- `browserless-secret.yaml` — only plaintext secret, should migrate to SOPS
- Terraform state is local (`terraform.tfstate` gitignored) — consider remote state backend (S3/Consul) for team collaboration
- No Terraform CI/CD — `tofu plan`/`apply` runs manually from a developer machine

### Known Issues
- `terraform.tfvars` contains a real API token and is in `.gitignore`, but `terraform.tfvars` (without the `.example` suffix) appears committed based on glob results — verify this is actually gitignored
- Autoscaler cold-start latency (~2 min for new Hetzner servers) may cause delays when scaling from 0

### Technical Debt
- Old deployment docs reference removed `make build HOST=`, `make provision`, `make secrets`, `make install-cert-manager`, `make setup-tls` targets
- The local Kind workflow (`k8s/local/`) and production workflow (`k8s/kustomization.yaml`) have diverged — local applies manifests individually via Makefile while production uses Kustomize + CI/CD
- The CI pipeline applies secrets by globbing `k8s/secrets/*.yaml k8s/clerk/*.secrets.yaml k8s/infrastructure/*.secrets.yaml` but does NOT apply `k8s/control-plane/oauth.secrets.yaml` — this may be a bug or intentional (oauth might be manually applied)

---

## Modification Guidance

### To Add a New Node Pool
1. Edit `k8s/hetzner/main.tf` — add entry to `agent_nodepools` or `autoscaler_nodepools`
2. Run `tofu plan` to preview, then `tofu apply`
3. Verify with `make prod/nodes`

### To Add a New Secret
1. Create `k8s/<category>/<name>.secrets.yaml` with the Secret manifest
2. Encrypt: `sops --encrypt --age "age1ase5...,age13zs0...,age17tt...,age1un8..." --encrypted-regex '^(stringData)$' --in-place <file>`
3. Add to `k8s/kustomization.yaml` resources (or update CI glob pattern)
4. Reference from deployment.yaml env vars
5. For local dev, add the secret to `k8s/local/local.secrets.yaml`

### To Change Server Types
1. Edit `k8s/hetzner/variables.tf` defaults or override in `terraform.tfvars`
2. Run `tofu plan` — note: changing server types will recreate nodes (causes downtime for that pool)
3. Apply during maintenance window

### To Add a New Domain/Ingress Route
1. Add DNS record pointing to the Hetzner Load Balancer IP
2. Edit `k8s/networking/ingress.yaml` — add new host under `tls` and `rules`
3. cert-manager will automatically provision TLS via HTTP01 challenge

### Testing Checklist for Changes
- [ ] `tofu validate` passes (if infra changes)
- [ ] `tofu plan` shows expected diff (if infra changes)
- [ ] `kubectl apply --dry-run=client` passes for all changed manifests
- [ ] `make prod/status` shows all pods Running after deployment
- [ ] TLS certificate is valid (`kubectl get certificate -n browser-streamer`)
- [ ] Control-plane health endpoint responds (`curl https://stream.dazzle.fm/health`)
- [ ] Streamer pod creation still works (create a stage via API)

---

_Generated by `document-project` workflow (deep-dive mode)_
_Base Documentation: docs/index.md_
_Scan Date: 2026-03-07_
_Analysis Mode: Exhaustive_
