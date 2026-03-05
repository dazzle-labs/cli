# Local Development (Kind)

Run the full stack locally using [Kind](https://kind.sigs.k8s.io/) (Kubernetes-in-Docker).

## Prerequisites

- **Docker Desktop** with **8GB+ RAM** allocated (Settings > Resources)
- **Kind**: `brew install kind`
- **kubectl**: `brew install kubectl`

## First-Time Setup

1. Build and deploy:

```bash
make local-up
```

This creates a Kind cluster, builds both images, and deploys everything. Secrets are SOPS-encrypted and decrypted automatically (requires an Age key listed in `.sops.yaml`). First run takes a while (streamer image is ~2GB).

3. Start the web dev server:

```bash
cd web && npm run dev
```

Open http://localhost:5173 — the dashboard proxies API calls to the local control-plane at http://localhost:8080.

## Daily Workflow

```bash
make local-up        # Start cluster (idempotent if already running)
cd web && npm run dev # Start frontend
# ... develop ...
make local-down      # Tear down when done (destroys all DB data)
```

**Note:** `make local-down` deletes the entire Kind cluster including postgres data. Any seeded test data will be lost.

## Rebuilding After Code Changes

**Control-plane changes:**
```bash
make local-build-cp && make local-deploy
```

**Streamer changes:**
```bash
make local-build-streamer
# Next stage created will use the new image
```

> **Note:** The streamer image is cross-compiled for amd64 (Chrome + OBS are x86-only). Building is slow on Apple Silicon due to QEMU emulation.

## Useful Commands

| Command | Description |
|---------|-------------|
| `make local-status` | Show pods and services |
| `make local-logs` | Tail control-plane logs |
| `make local-down` | Delete the Kind cluster |

## Troubleshooting

**Pods in CrashLoopBackOff / OOMKilled:**
Increase Docker Desktop memory to 8GB+ (Settings > Resources > Memory).

**Control-plane not reachable on localhost:8080:**
Check `make local-status` — the control-plane pod should be Running/Ready. If not, check logs with `make local-logs`.

**Image not updating after rebuild:**
Make sure you ran `make local-build-cp` (or `local-build-streamer`) which loads the image into Kind. Then `make local-deploy` to restart the pod.

**`kind create cluster` fails:**
If the cluster already exists, run `make local-down` first, then `make local-up`.
