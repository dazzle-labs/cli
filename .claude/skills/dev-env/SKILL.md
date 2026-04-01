---
name: dev-env
description: "Work with isolated dev environments on the Hetzner dev cluster. Use when deploying PR environments, debugging dev cluster issues, managing Tailscale routing, or bootstrapping the dev cluster."
allowed-tools: Bash, Read, Edit, Glob, Grep, Write
---

# Dev Environments

## When to Use
- Deploying, debugging, or tearing down PR-based dev environments
- Managing the dev Hetzner cluster (infra, bootstrap, secrets)
- Troubleshooting Tailscale subnet routing or split DNS

## Architecture
- **Cluster:** 2-node k3s on Hetzner (OpenTofu in `k8s/hetzner-dev/`)
- **CI:** GitHub Actions deploys on `deploy-dev` PR label, tears down on close/unlabel
- **Networking:** Tailscale subnet router (userspace mode) advertises `10.43.0.0/16`, CoreDNS split DNS resolves `*.dev.dazzle.fm` → Traefik ClusterIP
- **Secrets:** SOPS-encrypted with a separate dev Age key (cannot decrypt prod)
- **Isolation:** Each PR gets namespace `dev-pr-<N>`, with ResourceQuota, LimitRange, and default-deny NetworkPolicy

## Deploying a PR Environment

1. Add the `deploy-dev` label to a PR on `main`
2. CI builds all images with `pr-<N>` tags, deploys to `dev-pr-<N>` namespace
3. CI comments on the PR with the URL: `https://pr-<N>.dev.dazzle.fm`
4. Access requires Tailscale — the URL resolves only via split DNS on the tailnet
5. Remove the label or close the PR to tear down

## Cluster Operations

```bash
make dev-cluster/status          # Nodes and pods
make dev-cluster/kubectl ARGS="" # Run kubectl against dev cluster
make dev-cluster/bootstrap       # CRDs, GPU classes, Traefik, CI RBAC, Tailscale, split DNS
make dev-cluster/infra/plan      # Plan infra changes (safe)
make dev-cluster/infra/apply     # Apply infra changes (DESTRUCTIVE)
make dev-cluster/infra/destroy   # Destroy entire cluster (DESTRUCTIVE)
make dev-cluster/infra/init      # Re-init providers (after module/provider changes)
```

## Managing Secrets

Dev secrets live in `k8s/secrets-dev/`, encrypted with the dev Age key.

```bash
# Decrypt + apply a secret to a namespace
SOPS_AGE_KEY_FILE=~/.age/key.txt sops -d k8s/secrets-dev/<file>.yaml | \
  make dev-cluster/kubectl ARGS="apply -n <namespace> -f -"

# Edit a secret
SOPS_AGE_KEY_FILE=~/.age/key.txt sops k8s/secrets-dev/<file>.yaml

# Encrypt a new secret
SOPS_AGE_KEY_FILE=~/.age/key.txt sops --encrypt --in-place k8s/secrets-dev/<file>.yaml
```

The dev CI Age key (`AGE_DEV_SECRET_KEY`) is in GitHub Actions secrets. Personal Age keys in `.sops.yaml` can decrypt both prod and dev.

## Tailscale Setup

- Subnet router runs in `tailscale` namespace (userspace mode, no NET_ADMIN needed)
- Advertises `10.43.0.0/16` (full service CIDR)
- Split DNS: CoreDNS in `tailscale` namespace resolves `*.dev.dazzle.fm` → Traefik ClusterIP
- Tailscale admin has split DNS entry: `dev.dazzle.fm` → CoreDNS ClusterIP
- ACL must allow source tag → `10.43.0.0/16:*` destination

## Pitfalls

- **Tailscale "UDP is blocked"**: Expected in pod networking. Userspace mode (`TS_USERSPACE=true`) works over DERP relay. Do NOT use `hostNetwork: true` — it breaks ClusterIP routing.
- **Provider signing errors**: `isometry/deepmerge` 1.2.2 has a broken GPG signature on OpenTofu 1.11+. Pin to `1.2.1` in `providers.tf`.
- **kube-hetzner kured failure**: The module's kustomize post-install fetches kured from GitHub as a remote resource, which fails on MicroOS. Set `automatically_upgrade_os = false`.
- **Hetzner resource name collisions**: Dev and prod share the same API token. Set `cluster_name = "dev"` to prefix all resources.
- **Subnet routes not working**: Check three things: (1) route approved in Tailscale admin, (2) ACL allows CIDR in destination, (3) client has `--accept-routes`.
- **Split DNS not resolving**: Verify the CoreDNS ClusterIP in Tailscale admin split DNS matches `kubectl get svc split-dns -n tailscale`.
- **SOPS "no identity matched"**: Set `SOPS_AGE_KEY_FILE=~/.age/key.txt` or ensure your key is in the default search paths.

## Verification

```bash
# DNS works end-to-end
dig pr-1.dev.dazzle.fm +short
# Expected: 10.43.184.246 (Traefik ClusterIP)

# Traefik responds
curl -sk https://pr-1.dev.dazzle.fm
# Expected: 404 (no PR deployed) or the app

# Cluster is healthy
make dev-cluster/status

# Tailscale subnet routing works
ping -c 1 10.43.184.246
```
