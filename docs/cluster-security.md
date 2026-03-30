# Cluster Security

> Last Updated: 2026-03-30

## Overview

Production runs a 3-node HA k3s cluster on Hetzner Cloud, provisioned via OpenTofu + kube-hetzner module. This document covers infrastructure hardening, CI/CD authentication, secrets management, pod security, and RBAC. For per-pod network policies, see [Network Security](./network-security.md).

## Defense in Depth

Seven layers, each independent — compromising one layer does not bypass the others:

| Layer | What | How |
|-------|------|-----|
| **1. Network** | Firewall | SSH locked to single IP. K8s API open but protected by layers 2-4. Outbound restricted to RTMP + RunPod only. |
| **2. Transport** | TLS + WireGuard | All k8s API traffic TLS with CA verification. All pod-to-pod traffic encrypted via Cilium WireGuard. RunPod GPU comms use mTLS with CA pinning. |
| **3. Authentication** | Identity | Developers: client cert via kubeconfig (derived from encrypted tfstate at runtime). CI: GitHub OIDC tokens (short-lived, per-run). No long-lived cluster credentials stored anywhere. |
| **4. Authorization** | RBAC | CI user scoped to specific namespaces and resource types. Control-plane ServiceAccount scoped to pod lifecycle + CRDs. No cluster-admin in normal operations. |
| **5. Pod Security** | Container hardening | PSS baseline enforced. All pods: non-root, read-only rootfs, all capabilities dropped, seccomp RuntimeDefault. No privilege escalation. |
| **6. Network Policy** | Pod-to-pod isolation | Default-deny ingress + egress. Per-pod allowlists. Cilium L7 FQDN-based egress locks control-plane to specific external APIs. See [Network Security](./network-security.md). |
| **7. Audit** | Observability | kube-apiserver audit logging. Secrets and RBAC changes at RequestResponse level. All mutations at Metadata level. |

### Threat model

| Target | What an attacker needs |
|--------|----------------------|
| Cluster via CI | Compromise a GitHub Actions runner for `dazzle-labs/agent-streamer` on `main` branch (OIDC token is scoped to repo + ref) |
| Cluster via developer | Steal an age private key + have network access to API server IP |
| App secrets only | Steal any one age private key (cannot grant cluster access — OIDC replaced that path) |
| Pod escape | Break out of non-root, read-only rootfs, no-capabilities, seccomp container, then past network policies |
| Lateral movement | Bypass default-deny network policies + Cilium FQDN restrictions |

No single secret grants full access. OIDC tokens are ephemeral, the age key only decrypts app secrets (not cluster auth), and the kubeconfig doesn't exist as a file.

## Infrastructure Hardening

### Firewall (Hetzner Cloud)

| Rule | Source/Dest | Port | Notes |
|------|------------|------|-------|
| SSH | `174.34.8.214/32` | 22 | Locked to single admin IP |
| K8s API | `0.0.0.0/0` | 6443 | Open — gated by client cert + OIDC auth (see below) |
| RTMP (outbound) | `0.0.0.0/0` | 1935 | Stream output to external platforms |
| RunPod (outbound) | `0.0.0.0/0` | 1024-65535 | GPU sidecar mTLS comms (RunPod IPs are dynamic) |

The k8s API is deliberately open because GitHub Actions CI uses dynamic IPs. Access is protected by two layers: client certificate authentication (kubeconfig) for developers, and OIDC tokens for CI (see below). The broad RunPod egress rule is a secondary defense — Cilium L7 policies provide the real restriction at the pod level.

Config: `k8s/hetzner/variables.tf` (`firewall_ssh_source`, `firewall_kube_api_source`, `extra_firewall_rules`)

### Audit Logging

The kube-apiserver is configured with an audit policy that logs:

| Level | Scope | What's captured |
|-------|-------|-----------------|
| `RequestResponse` | Secrets access | Full request + response body |
| `RequestResponse` | RBAC changes | Full request + response body |
| `Metadata` | All mutations (create/update/patch/delete) | Who, what, when (no body) |
| `None` | Read-only operations, events, system components | Not logged |

Logs rotate at 100MB, kept for 7 days, max 3 backups. Stored at `/var/log/k3s-audit.log` on control plane nodes.

Config: `k8s/hetzner/main.tf` (`preinstall_exec` writes the policy, `k3s_exec_server_args` enables it)

### WireGuard

All pod-to-pod traffic is encrypted via WireGuard, managed by Cilium. This is transparent to applications — no configuration required per-pod.

## CI/CD Authentication (GitHub OIDC)

CI authenticates to the k8s cluster using **GitHub Actions OIDC tokens** — short-lived JWTs issued by GitHub for each workflow run. No long-lived cluster credentials are stored in GitHub.

### How it works

1. GitHub Actions mints a JWT with subject `repo:dazzle-labs/agent-streamer:ref:refs/heads/main`
2. The kube-apiserver validates it against GitHub's OIDC issuer (`token.actions.githubusercontent.com`)
3. The `--oidc-username-prefix=github:` flag maps the token to user `github:repo:dazzle-labs/agent-streamer:ref:refs/heads/main`
4. RBAC bindings grant this user scoped permissions (see CI RBAC below)

### kube-apiserver OIDC flags

```
--oidc-issuer-url=https://token.actions.githubusercontent.com
--oidc-client-id=kubernetes
--oidc-username-claim=sub
--oidc-username-prefix=github:
--oidc-groups-claim=repository
```

Config: `k8s/hetzner/main.tf` (`k3s_exec_server_args`)

### GitHub repository configuration

| Type | Name | Purpose |
|------|------|---------|
| Variable | `K8S_API_SERVER` | API server URL (`https://<ip>:6443`) |
| Secret | `K8S_CA_CERT` | Base64-encoded CA certificate for TLS verification |
| Secret | `AGE_SECRET_KEY` | Age private key for SOPS secret decryption |

The `AGE_SECRET_KEY` is used only for decrypting application secrets (DB passwords, API keys) via SOPS — it cannot be used to gain cluster access since OIDC replaced kubeconfig-based auth.

### Workflow setup

Both `ci.yml` and `restart.yml` use the same pattern:

```yaml
permissions:
  id-token: write  # Request OIDC token

steps:
  - name: Authenticate to k8s via OIDC
    env:
      K8S_CA_CERT_B64: ${{ secrets.K8S_CA_CERT }}
    run: |
      TOKEN=$(curl -sH "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
        "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=kubernetes" | jq -r .value)
      python3 -c "import base64,os; open('/tmp/k8s-ca.crt','wb').write(base64.b64decode(os.environ['K8S_CA_CERT_B64']))"
      kubectl config set-cluster prod \
        --server=${{ vars.K8S_API_SERVER }} \
        --certificate-authority=/tmp/k8s-ca.crt \
        --embed-certs=true
      kubectl config set-credentials ci --token="$TOKEN"
      kubectl config set-context prod --cluster=prod --user=ci
      kubectl config use-context prod
```

The CA cert is passed via environment variable and decoded with python to avoid shell interpolation issues with base64 content.

## Secrets Management

### Design principle: derive, don't store

Secrets that can be derived from other encrypted sources are not stored separately. The cluster kubeconfig is an output of the Terraform state — rather than maintaining a separate encrypted copy, it is extracted from the encrypted tfstate at runtime and never written to disk beyond the lifetime of a single command.

### What's in the repository

| File | Purpose | Why it's here |
|------|---------|---------------|
| `k8s/hetzner/terraform.tfstate.enc` | Encrypted Terraform state | Source of truth for all infra state. Contains kubeconfig, node IPs, resource IDs. No remote state backend. |
| `k8s/hetzner/ssh_key.enc` | Encrypted SSH private key | Terraform input — needed by kube-hetzner module during `tofu apply` to provision nodes. Cannot be derived from state. |
| `k8s/hetzner/ssh_key.pub` | SSH public key | Not secret. |
| `k8s/secrets/*.secrets.yaml` | Application secrets (DB passwords, API keys, TLS certs) | SOPS-encrypted k8s Secret manifests. Decrypted at deploy time via `sops --decrypt \| kubectl apply`. |
| `k8s/local/local.secrets.yaml` | Local dev secrets | Same as above, for Kind cluster. |

All secrets are SOPS-encrypted with Age keys. `.sops.yaml` defines creation rules mapping file patterns to Age public keys. Any single recipient's private key is sufficient to decrypt.

### What's NOT in the repository

| Secret | Where it lives | How it's accessed |
|--------|---------------|-------------------|
| Cluster kubeconfig | Derived from `terraform.tfstate.enc` at runtime | Makefile extracts via `sops -d \| python3`, passes as temp file to kubectl, cleaned up on exit |
| CI cluster credentials | GitHub Actions OIDC token (ephemeral) | Minted per-workflow-run, expires automatically |
| CA certificate | GitHub Secret (`K8S_CA_CERT`) | Extracted from tfstate, stored as base64 in GitHub |

### Developer access to production cluster

The Makefile `prod/*` targets extract the kubeconfig from encrypted tfstate on the fly:

```
make prod/status      # Decrypts tfstate → extracts kubeconfig → runs kubectl → cleans up
make prod/kubectl ARGS="get pods -n browser-streamer"
make prod/k8s/deploy  # Same pattern, passes KUBECONFIG to k8s/Makefile
```

The kubeconfig exists only as a temp file for the duration of the command. Developers need their Age private key at `~/.age/key.txt` (configured via `SOPS_AGE_KEY_FILE` in the Makefile).

### Key rotation

To rotate Age keys:
1. Update `.sops.yaml` with new public keys
2. Run `sops updatekeys -y` on each encrypted file
3. Run `sops updatekeys -y --input-type <type>` for `.enc` files (sops can't auto-detect the extension)
4. After `tofu apply`, re-extract the CA cert and update the `K8S_CA_CERT` GitHub secret

## Pod Security

### Pod Security Standards

The `browser-streamer` namespace enforces PSS at two levels:

```yaml
pod-security.kubernetes.io/enforce: baseline
pod-security.kubernetes.io/warn: restricted
```

All violations of `baseline` are blocked. Violations of `restricted` produce warnings but are allowed (needed for some workloads).

### Per-pod security context

All pods run with:
- `runAsNonRoot: true` (control-plane as nobody/65534, postgres as postgres/70)
- `readOnlyRootFilesystem: true` (control-plane)
- `allowPrivilegeEscalation: false`
- `capabilities: drop: ["ALL"]`
- `seccompProfile: RuntimeDefault`

Ingest (nginx-rtmp) adds minimal capabilities: `NET_BIND_SERVICE`, `CHOWN`, `SETUID`, `SETGID`.

Config: `k8s/control-plane/deployment.yaml`, `k8s/ingest/deployment.yaml`, `k8s/infrastructure/postgres.yaml`

## RBAC

### Application RBAC

The `control-plane` ServiceAccount has namespace-scoped permissions:
- Pods: create, delete, get, list, watch (stage lifecycle)
- Dazzle CRDs (`gpunodes`, `gpunodeclasses`, `gpustages`): full CRUD
- Leases: get, create, update (leader election)
- ClusterRole: read-only access to CRD definitions

No cluster-admin or broad cluster permissions.

Config: `k8s/control-plane/rbac.yaml`

### CI RBAC

The OIDC-authenticated CI user has scoped permissions across four namespaces:

| Namespace | Resources | Verbs |
|-----------|-----------|-------|
| `browser-streamer` | Pods, services, configmaps, serviceaccounts, PVCs, deployments, statefulsets, PDBs, Traefik middlewares, Dazzle CRs, PodMonitors | Full CRUD |
| `browser-streamer` | Secrets | Write-only (create, update, patch — CI applies SOPS-decrypted manifests, never reads back) |
| `browser-streamer` | Network policies | No delete (create, update, patch — prevent CI from removing network isolation) |
| `browser-streamer` | Cilium policies | Full CRUD (delete needed — control-plane Role grants ciliumnetworkpolicies:delete, RBAC escalation check requires CI to hold it too) |
| `browser-streamer` | RBAC (roles, rolebindings) | Full CRUD, scoped to `resourceNames: [control-plane, ci-deploy]` |
| `monitoring` | Secrets | Write-only (create, update, patch) |
| `monitoring` | RBAC | Full CRUD, scoped to `resourceNames: [ci-deploy]` |
| `kube-system` | ConfigMaps, ServiceAccounts, services, deployments, HelmChartConfigs | Full CRUD (scheduler-plugins + Traefik config) |
| `kube-system` | RBAC | Full CRUD, scoped to `resourceNames: [ci-deploy, sched-plugins::extension-apiserver-authentication-reader]` |
| `default` | Dazzle CRs | Full CRUD (GPU node classes have no namespace specified) |
| `default` | RBAC | Full CRUD, scoped to `resourceNames: [ci-deploy]` |

Cluster-scoped: CRDs (get, create, update, patch), namespaces (get, create, update, patch), PriorityClasses (full CRUD), ClusterRoles/Bindings (full CRUD, scoped to `resourceNames: [scheduler-plugins-controller, scheduler-plugins-scheduler, scheduler-plugins-metrics-reader, ci-deploy, control-plane-crds]`).

**Security constraints:** `resourceNames` does not restrict `create` (Kubernetes ignores it for that verb), but it blocks CI from modifying or deleting any Role/ClusterRole other than the named ones — closing the privilege escalation path where a compromised runner could bind itself to `cluster-admin`.

Config: `k8s/control-plane/ci-rbac.yaml`
