---
name: 'k8s'
description: 'Work with Kubernetes infrastructure - local Kind cluster or production Hetzner cluster. Use when the user wants to deploy, debug pods, check status, manage secrets, modify manifests, work with Helm charts, or troubleshoot k8s issues.'
---

Before taking any k8s action, load the relevant context by reading these files:

<context-loading>
1. **Always read first:**
   - `Makefile` (root) — all make targets for local and prod k8s operations
   - `k8s/Makefile` — k8s-specific targets (deploy, secrets, prometheus, trimaran, verify)
   - `CLAUDE.md` — quick reference and safety rules

2. **For manifest work**, read the relevant files under `k8s/`:
   - `k8s/kustomization.yaml` — root Kustomization listing all resources + Helm charts
   - `k8s/control-plane/` — deployment, service, rbac, oauth secrets
   - `k8s/infrastructure/` — postgres StatefulSet, encrypted secrets
   - `k8s/networking/` — ingress (stream.dazzle.fm), TLS, traefik config
   - `k8s/monitoring/` — prometheus values, streamer PodMonitor
   - `k8s/scheduling/` — priority classes, placeholder pod, trimaran values

3. **For local dev**, also read:
   - `k8s/local/kind-config.yaml` — Kind cluster port mappings
   - `k8s/local/service.yaml` — NodePort override for Kind
   - `docs/local-dev.md` — local development guide

4. **For production**, also read:
   - `docs/deployment-guide.md` — cluster topology, TLS, CI/CD, provisioning
   - `docs/deep-dive-hetzner-k8s-infrastructure.md` — exhaustive infra analysis
   - `k8s/hetzner/` — OpenTofu configs (main.tf, variables.tf, providers.tf)
   - `.github/workflows/ci.yml` — CI/CD build and deploy pipeline

5. **For secrets**, also read:
   - `.sops.yaml` — SOPS encryption rules and Age recipients
</context-loading>

<safety-rules CRITICAL="TRUE">
- **NEVER** run `make prod/infra/apply` or `tofu apply` without explicit human approval. Always run `prod/infra/plan` first and have the user review output.
- **NEVER** delete production secrets, namespaces, or PVCs without explicit confirmation.
- **NEVER** decrypt secrets to disk or echo secret values to stdout.
- For production kubectl commands, use `make prod/kubectl ARGS="..."` — do not directly invoke kubectl with production kubeconfig.
- No state locking exists for OpenTofu — only one person should run infra commands at a time.
</safety-rules>

<key-patterns>
- Local Kind context: `kind-browser-streamer`
- Namespace: `browser-streamer`
- Images: `dazzlefm/agent-streamer-control-plane:main`, `dazzlefm/agent-streamer-stage:main`
- Secrets are SOPS Age-encrypted; edit with `sops <file>` (requires Age key at `~/.config/sops/age/keys.txt`)
- Prometheus installed via explicit `helm upgrade --install` (not kustomize) due to CRD ordering
- Trimaran installed via kustomize `helmCharts` (no CRD deps)
- If Helm install fails with "exists and cannot be imported" — delete ALL orphaned resources before retrying
- CI uses `azure/setup-helm@v4` pinned to `version: 'v3.17.3'` (Helm 4 broke `-c` flag)
- Process substitution `<(sops -d ...)` does NOT work in Make variables — use temp file + KUBECONFIG env
- `sops -d` on `.yaml.enc` files requires `--input-type yaml --output-type yaml`
</key-patterns>
