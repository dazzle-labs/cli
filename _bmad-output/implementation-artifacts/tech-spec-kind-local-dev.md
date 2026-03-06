---
title: 'Kind-Based Local Development Environment'
slug: 'kind-local-dev'
created: '2026-03-04'
status: 'implementation-complete'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['kind', 'docker', 'make', 'k8s', 'go', 'node']
files_to_modify: ['Makefile', 'k8s/local/kind-config.yaml', 'k8s/local/secrets.yaml.example', 'k8s/local/service.yaml', '.gitignore']
code_patterns: ['remote SSH builds via buildctl', 'SOPS-encrypted secrets', 'imagePullPolicy: Never', 'InClusterConfig for k8s auth', 'namespace: browser-streamer']
test_patterns: []
---

# Tech-Spec: Kind-Based Local Development Environment

**Created:** 2026-03-04

## Overview

### Problem Statement

All components (control-plane, streamer, postgres) can only run on the remote k3s cluster via SSH-based builds and deploys. There is no way to develop, test, or iterate locally without deploying to the VPS, which slows the feedback loop significantly.

### Solution

Create a Kind (Kubernetes-in-Docker) based local development environment that reuses the existing k8s manifests and Dockerfiles to spin up the full stack locally. The web dashboard already works locally via `npm run dev` with Vite proxy, so it's excluded — it just needs the control-plane reachable on localhost:8080.

### Scope

**In Scope:**
- Kind cluster configuration file with extraPortMappings for reliable host access
- Local image build targets using standard `docker build` (not remote SSH)
- Local postgres, control-plane, and streamer running in Kind
- Local secrets setup with plaintext dev secrets (not SOPS)
- Makefile targets for local dev lifecycle (`make local-up`, `make local-down`, `make local-build`, etc.)
- NodePort service variant so the web dev server can reach the local control-plane on :8080

**Out of Scope:**
- Modifying control-plane Go code (Kind provides in-cluster config natively, no `InClusterConfig` changes needed)
- TLS / cert-manager / Traefik locally
- Clerk auth changes (use same Clerk dev keys)
- CI/CD pipeline
- Changes to the remote deploy workflow

## Context for Development

### Codebase Patterns

- **Remote builds only**: All builds use SSH + buildctl on the VPS. `docker build` is never invoked locally. Dockerfiles exist at `control-plane/docker/Dockerfile` and `streamer/docker/Dockerfile` and are fully functional — just need to be targeted with local `docker build` instead.
- **imagePullPolicy: Never**: Both control-plane and streamer images use `imagePullPolicy: Never`. This is ideal for Kind since `kind load docker-image` pre-loads images into the cluster.
- **InClusterConfig**: The control-plane uses `rest.InClusterConfig()` for k8s auth. Kind provides this automatically via service account injection — no code changes needed.
- **Namespace**: Everything runs in `browser-streamer` namespace. Kind doesn't create this by default — needs explicit creation (idempotent: `kubectl create namespace browser-streamer --dry-run=client -o yaml | kubectl apply -f -`).
- **Secrets**: Four k8s secrets are required:
  - `postgres-auth` (password) — SOPS-encrypted in prod
  - `clerk-auth` (secret-key) — SOPS-encrypted in prod
  - `encryption-key` (key) — SOPS-encrypted in prod
  - `browserless-auth` (token) — plaintext in `k8s/networking/browserless-secret.yaml`
- **Streamer pod creation**: The control-plane creates streamer pods imperatively via `client-go` (not from manifests). Pod spec is hardcoded in `main.go:228-300`. Uses `ImagePullPolicy: Never`, references `browserless-auth` secret, requests 2 CPU / 4Gi RAM.
- **Postgres**: StatefulSet with PVC (5Gi), `postgres:16-alpine`, user/db = `browser_streamer`.
- **Control-plane Dockerfile**: Multi-stage — builds web (Node 24), builds Go binary (Go 1.25), copies both into alpine. Also installs `gobs-cli`. Build context must be the repo root so that `COPY web/...` and `COPY control-plane/...` paths resolve correctly.
- **Streamer Dockerfile**: Ubuntu 24.04 base with Xvfb, Chrome, OBS, PulseAudio, Node 20, ffmpeg. Heavy image (~2GB+). Build context is `streamer/` with Dockerfile at `streamer/docker/Dockerfile`.

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `Makefile` | Root Makefile — will add local-* targets here |
| `control-plane/Makefile` | Remote build/deploy for control-plane (pattern reference) |
| `streamer/Makefile` | Remote build for streamer (pattern reference) |
| `control-plane/docker/Dockerfile` | Multi-stage build: web + Go + alpine |
| `streamer/docker/Dockerfile` | Ubuntu + Chrome + OBS + Node streamer image |
| `k8s/infrastructure/postgres.yaml` | Postgres StatefulSet + PVC + Service (reused as-is) |
| `k8s/control-plane/deployment.yaml` | Control-plane Deployment (reused as-is) |
| `k8s/control-plane/service.yaml` | Control-plane ClusterIP Service (production; local uses NodePort variant) |
| `k8s/control-plane/rbac.yaml` | ServiceAccount + Role + RoleBinding (reused as-is) |
| `k8s/networking/browserless-secret.yaml` | Plaintext pod auth token (reused as-is) |
| `control-plane/main.go:228-300` | Streamer pod spec (imperatively created) |

### Technical Decisions

1. **Kind over minikube/k3d**: Kind runs k8s inside Docker containers, works on macOS natively via Docker Desktop, and supports `kind load docker-image` for pre-loading images (matching the `imagePullPolicy: Never` pattern already in use).

2. **Reuse existing k8s manifests**: The postgres, RBAC, and deployment manifests can be applied to Kind as-is. Only secrets and the control-plane service need local variants.

3. **NodePort + extraPortMappings over port-forward**: Use Kind's `extraPortMappings` to map host port 8080 → Kind node port, combined with a NodePort service variant for the control-plane. This provides a persistent, reliable mapping without a fragile background `kubectl port-forward` process. The local service variant lives in `k8s/local/service.yaml`.

4. **Committed config, gitignored secrets**: `k8s/local/kind-config.yaml` and `k8s/local/secrets.yaml.example` are committed to the repo (no sensitive data). Only `k8s/local/secrets.yaml` (the actual secrets file with user's Clerk key) is gitignored.

5. **`local-up` depends on `local-build`**: First-time setup runs `make local-build` as a prerequisite of `make local-up`, so new users get a working cluster without remembering to build first. Subsequent iterations use `make local-build-cp && make local-deploy` for fast feedback.

6. **Idempotent operations**: All `local-up` operations use idempotent patterns (`--dry-run=client -o yaml | kubectl apply -f -` for namespace creation, `kubectl apply` for manifests) so the target is safely re-runnable.

7. **Local `docker build`**: Build images locally with standard `docker build` using the existing Dockerfiles. Control-plane build context = repo root, Dockerfile = `control-plane/docker/Dockerfile`. Streamer build context = `streamer/`, Dockerfile = `streamer/docker/Dockerfile`.

## Implementation Plan

### Tasks

- [x] Task 1: Create Kind cluster configuration
  - File: `k8s/local/kind-config.yaml`
  - Action: Create a Kind cluster config with a single node and `extraPortMappings` to map host port 8080 → container port 30080 (the NodePort the local service will use).
  - Notes: Use `kind: Cluster`, `apiVersion: kind.x-k8s.io/v1alpha4`. The mapping uses `containerPort: 30080`, `hostPort: 8080`, `protocol: TCP`. This file is committed (no secrets).

- [x] Task 2: Create local NodePort service variant
  - File: `k8s/local/service.yaml`
  - Action: Create a copy of `k8s/control-plane/service.yaml` but with `type: NodePort` and `nodePort: 30080` instead of ClusterIP. Same selector (`app: control-plane`), same target port (8080).
  - Notes: This file is committed (no secrets). Applied instead of the production ClusterIP service during `local-up`.

- [x] Task 3: Create local dev secrets template and actual file
  - File: `k8s/local/secrets.yaml.example` (committed) + `k8s/local/secrets.yaml` (gitignored)
  - Action: Create a single YAML file containing all four required secrets with dev-safe values:
    - `postgres-auth`: password = `localdev`
    - `clerk-auth`: secret-key = `sk_test_REPLACE_ME` (user must supply their own Clerk test key)
    - `encryption-key`: key = a valid 32-byte hex string (fixed value for local dev, e.g., 64 hex chars)
    - `browserless-auth`: token = `localdev`
  - Notes: All secrets in `namespace: browser-streamer`. Include a comment at the top instructing the user to copy to `secrets.yaml` and fill in their Clerk test secret key. The `.example` file is committed; the actual `secrets.yaml` is gitignored.

- [x] Task 4: Update `.gitignore`
  - File: `.gitignore`
  - Action: Add `k8s/local/secrets.yaml` entry to prevent committing the actual secrets file (but allow `kind-config.yaml`, `service.yaml`, and `secrets.yaml.example` to be committed).
  - Notes: Only the actual secrets file is sensitive.

- [x] Task 5: Add local Makefile targets
  - File: `Makefile`
  - Action: Add the following targets to the root Makefile:
    - `local-build`: Build both images locally with `docker build` and load them into Kind with `kind load docker-image --name browser-streamer`. Control-plane: `docker build -f control-plane/docker/Dockerfile --build-arg VITE_CLERK_PUBLISHABLE_KEY=$(CLERK_PK) -t control-plane:latest .` (context = repo root). Streamer: `docker build -f streamer/docker/Dockerfile -t browser-streamer:latest streamer/` (context = `streamer/`).
    - `local-build-cp`: Build only control-plane image locally and load into Kind.
    - `local-build-streamer`: Build only streamer image locally and load into Kind.
    - `local-up`: Depends on `local-build`. Create Kind cluster (`kind create cluster --name browser-streamer --config k8s/local/kind-config.yaml`), create namespace (idempotent), apply secrets from `k8s/local/secrets.yaml`, apply `k8s/networking/browserless-secret.yaml`, apply postgres manifest, apply RBAC + deployment for control-plane, apply local NodePort service (`k8s/local/service.yaml`), wait for postgres ready, wait for control-plane ready.
    - `local-down`: Delete the Kind cluster (`kind delete cluster --name browser-streamer`).
    - `local-deploy`: Apply all k8s manifests to the Kind cluster (same as `local-up` apply steps), then `kubectl rollout restart deployment/control-plane` + `kubectl rollout status` to pick up new images.
    - `local-logs`: Tail control-plane logs from Kind cluster.
    - `local-status`: Show pods, services in the Kind cluster's `browser-streamer` namespace.
  - Notes: Use `kubectl` (not `k3s kubectl`). Set `--context kind-browser-streamer` on all kubectl commands to avoid affecting other clusters. Define `KCTL := kubectl --context kind-browser-streamer -n browser-streamer` as a variable for DRY. The `CLERK_PK` build arg defaults to the same value as the remote build but is overridable.

- [x] Task 6: Document local dev setup
  - File: `docs/local-dev.md`
  - Action: Create a brief guide covering:
    - Prerequisites (Docker Desktop with 8GB+ RAM allocated, Kind, kubectl)
    - First-time setup: `cp k8s/local/secrets.yaml.example k8s/local/secrets.yaml`, fill in Clerk key, `make local-up` (builds + deploys)
    - Daily workflow: `make local-up`, `cd web && npm run dev`, develop, `make local-down`
    - Rebuilding after code changes: `make local-build-cp && make local-deploy`
    - Troubleshooting (Docker Desktop resource limits, pod crashloop, image not updating)
  - Notes: Keep it concise — match the minimal documentation style of the project. Emphasize Docker Desktop memory requirement (8GB+) prominently.

### Acceptance Criteria

- [ ] AC 1: Given Docker Desktop and Kind are installed, when the user runs `make local-up`, then a Kind cluster named `browser-streamer` is created with the `browser-streamer` namespace, all secrets applied, postgres running and ready, control-plane deployed and healthy, and the control-plane API reachable at `http://localhost:8080/health`.

- [ ] AC 2: Given the Kind cluster is running, when the user runs `cd web && npm run dev` and opens the browser, then the dashboard loads and API calls proxy successfully to the local control-plane via `localhost:8080`.

- [ ] AC 3: Given the user modifies control-plane Go code, when they run `make local-build-cp && make local-deploy`, then the new image is built locally, loaded into Kind, the control-plane pod restarts with the new code, and `kubectl rollout status` confirms the rollout completed.

- [ ] AC 4: Given the user modifies streamer code, when they run `make local-build-streamer`, then the new streamer image is built locally and loaded into Kind, and the next streamer pod created by the control-plane uses the updated image.

- [ ] AC 5: Given the Kind cluster is running, when the user runs `make local-down`, then the Kind cluster is fully deleted and no Docker resources remain.

- [ ] AC 6: Given a fresh clone of the repo, when the user runs `git status`, then `k8s/local/kind-config.yaml`, `k8s/local/service.yaml`, and `k8s/local/secrets.yaml.example` are tracked, but `k8s/local/secrets.yaml` is not.

- [ ] AC 7: Given the control-plane is running in Kind, when a stage is created via the API, then the control-plane successfully creates a streamer pod in the Kind cluster using `client-go` with `InClusterConfig`.

- [ ] AC 8: Given `make local-up` has already been run, when the user runs `make local-up` again, then the command completes without errors (idempotent — Kind cluster already exists is handled gracefully).

## Additional Context

### Dependencies

- **Docker Desktop** (or Docker Engine on Linux): Required for both `docker build` and Kind cluster nodes. Must be configured with at least 8GB RAM for running the full stack including streamer pods.
- **Kind CLI**: `go install sigs.k8s.io/kind@latest` or `brew install kind`.
- **kubectl**: Standard Kubernetes CLI, needed for `apply`, `logs`, `rollout`, etc.
- **Clerk test/dev secret key**: User must obtain from their Clerk dashboard and paste into `k8s/local/secrets.yaml`.

### Testing Strategy

- **Manual validation only** (no test suites exist in this project):
  1. Run `make local-up` — verify all pods reach Running/Ready state
  2. Run `make local-status` — verify postgres and control-plane pods are healthy
  3. `curl http://localhost:8080/health` — verify control-plane is reachable via NodePort
  4. Open `http://localhost:5173` (web dev server) — verify dashboard loads
  5. Create a stage via the dashboard — verify streamer pod is created in Kind
  6. Run `make local-down` — verify clean teardown
  7. Run `make local-up` again — verify idempotent re-run works
  8. Modify Go code, run `make local-build-cp && make local-deploy` — verify rebuild cycle

### Notes

- **Streamer image is heavy (~2GB+)**: First `make local-build-streamer` will take a while. Subsequent builds benefit from Docker layer caching.
- **Resource constraints**: The streamer pod requests 2 CPU / 4Gi RAM with limits of 4 CPU / 8Gi. Docker Desktop must be configured with at least 8GB RAM to run the full stack. Document this prominently in `docs/local-dev.md`.
- **Clerk dev vs prod keys**: The local setup uses whatever Clerk key the user provides. For full functionality, they should use a Clerk development instance key, not the production key.
- **No networking/ingress locally**: No Traefik, no TLS, no ingress. The control-plane is accessed via Kind extraPortMappings + NodePort. Streamer pods are accessed by the control-plane via cluster-internal pod IP (same as production).
- **Kind cluster already exists**: `local-up` should handle the case where the Kind cluster already exists gracefully (either skip creation or error with a helpful message suggesting `make local-down` first).
