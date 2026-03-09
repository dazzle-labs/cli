# Local Development (Kind)

Run the full stack locally using [Kind](https://kind.sigs.k8s.io/) (Kubernetes-in-Docker).

## Prerequisites

- **Docker Desktop** with **8GB+ RAM** allocated (Settings > Resources)
- **Kind**: `brew install kind`
- **kubectl**: `brew install kubectl`
- **SOPS**: `brew install sops` (+ Age key in `~/.config/sops/age/keys.txt`)

## Quick Start

```bash
make dev
```

This builds all images, creates a Kind cluster, deploys the full stack, then starts the web dev server + control-plane log tail. First run takes a while (streamer image is ~2GB).

- **Dashboard:** http://localhost:5173
- **Control plane API:** http://localhost:8080

## Daily Workflow

```bash
make dev         # Start everything (idempotent if cluster already running)
# ... develop ...
# Ctrl-C to stop watchers (prompted to tear down cluster)
make down        # Or tear down manually (destroys all DB data)
```

**Note:** `make down` deletes the entire Kind cluster including postgres data.

## Rebuilding After Code Changes

**Control-plane changes:**
```bash
make build-cp deploy
```

**Streamer changes:**
```bash
make build-streamer
# Next stage created will use the new image
```

**Sidecar changes:**
```bash
make build-sidecar
```

> **Note:** The streamer image is cross-compiled for amd64 (Chrome + OBS are x86-only). Building is slow on Apple Silicon due to QEMU emulation.

## Useful Commands

| Command | Description |
|---------|-------------|
| `make up` | Build + deploy to Kind (without starting watchers) |
| `make kubectx` | Set kubectl context to Kind cluster (then use kubectl directly) |
| `make status` | Show pods and services |
| `make logs` | Tail control-plane logs |
| `make down` | Delete the Kind cluster |
| `make web/dev` | Run web dev server only |

## Troubleshooting

**Pods in CrashLoopBackOff / OOMKilled:**
Increase Docker Desktop memory to 8GB+ (Settings > Resources > Memory).

**Control-plane not reachable on localhost:8080:**
Check `make status` — the control-plane pod should be Running/Ready. If not, check logs with `make logs`.

**Image not updating after rebuild:**
Make sure you ran `make build-cp` (or `build-streamer`) which loads the image into Kind. Then `make deploy` to restart the pod.

**`kind create cluster` fails:**
If the cluster already exists, run `make down` first, then `make up`.
