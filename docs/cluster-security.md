# Cluster Security

> Last Updated: 2026-03-30

## Overview

Production runs a 3-node HA k3s cluster on Hetzner Cloud, provisioned via OpenTofu + kube-hetzner module. This document covers infrastructure hardening, CI/CD authentication, secrets management, pod security, and RBAC. For per-pod network policies, see [Network Security](./network-security.md).

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

All secrets are SOPS-encrypted with Age keys, stored in the repository.

### Encryption recipients

`.sops.yaml` defines creation rules mapping file patterns to Age public keys. All recipients can decrypt; any single recipient's private key is sufficient.

### Secret categories

| Pattern | Location | Encryption scope |
|---------|----------|-----------------|
| `*.secrets.yaml` | `k8s/secrets/`, `k8s/local/` | `stringData` or `data` fields only |
| `*.env` | Various | Entire file |
| `kubeconfig.yaml.enc` | `k8s/hetzner/` | Entire file |
| `ssh_key.enc` | `k8s/hetzner/` | Entire file (binary) |
| `terraform.tfstate.enc` | `k8s/hetzner/` | Entire file |

### Key rotation

To rotate Age keys:
1. Update `.sops.yaml` with new public keys
2. Run `sops updatekeys -y` on each encrypted file
3. Run `sops updatekeys -y --input-type <type>` for `.enc` files (sops can't auto-detect the extension)

### Developer access

Developers store their Age private key at `~/.age/key.txt`. The Makefile sets `SOPS_AGE_KEY_FILE` to this path by default.

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

> **Status:** RBAC manifests are deployed. CI authenticates via OIDC and these bindings control what it can do. The OIDC + RBAC pipeline is being validated — if permission gaps are found, the Role rules below will be adjusted.

The OIDC-authenticated CI user has scoped permissions across three namespaces:

| Namespace | Resources | Verbs |
|-----------|-----------|-------|
| `browser-streamer` | Pods, services, configmaps, secrets, deployments, statefulsets, PDBs, network policies, Cilium policies, Traefik middlewares, RBAC, Dazzle CRs, PodMonitors | Full CRUD |
| `monitoring` | Secrets | Get, create, update, patch |
| `kube-system` | ConfigMaps, ServiceAccounts, services, deployments, RBAC | Full CRUD (scheduler-plugins Helm chart) |

Cluster-scoped: CRDs (get, create, update, patch), namespaces (get, create), PriorityClasses (full CRUD), ClusterRoles/Bindings (full CRUD for scheduler-plugins).

Config: `k8s/control-plane/ci-rbac.yaml`
