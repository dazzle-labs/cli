# CLAUDE.md

For complete architecture, build, deployment, and development guidance, see **[docs/index.md](docs/index.md)**.

## Quick Start

```bash
make dev    # Builds everything, starts Kind cluster, runs web dev server + log tail
```

This is the primary command for local development. It runs `make up` (build images, create cluster, deploy), then starts web dev server + control-plane log tail in parallel.

## Make Commands

### Local (Kind) — default
```bash
make dev                         # ★ Full local dev — build, deploy, watch everything
make up                          # Create Kind cluster, build images, deploy full stack
make down                        # Delete the Kind cluster
make build                       # Build all images and load into Kind
make build-cp                    # Build control-plane image and load into Kind
make build-streamer              # Build streamer image and load into Kind
make deploy                      # Apply manifests and restart control-plane in Kind
make logs                        # Tail control-plane logs in Kind
make status                      # Show pods and services in Kind
make proto                       # Generate protobuf code (Go + TypeScript)
make web/dev                     # Run web dev server only
```

Secrets are SOPS-encrypted in `k8s/local/local.secrets.yaml` (requires Age key). See [docs/local-dev.md](docs/local-dev.md).

### Remote (VPS via SSH) — `remote/` prefix
```bash
make remote/build                # Build all images on remote host
make remote/build-streamer       # Build streamer image on remote host
make remote/build-control-plane  # Build control-plane image on remote host
make remote/deploy               # Apply k8s manifests + restart on remote
make remote/restart              # Restart control-plane pod on remote
make remote/deploy-secrets       # Decrypt SOPS secrets and apply to remote cluster
make remote/install-cert-manager # Install cert-manager on remote cluster
make remote/setup-tls            # Apply Traefik config, ClusterIssuer, Ingress on remote
make remote/status               # Show pods, services, ingress, certificates on remote
make remote/logs                 # Tail control-plane logs on remote
make remote/clean                # Delete all session pods on remote
make remote/provision HOST=x.x.x.x  # Full provision from scratch
```

See [docs/index.md](docs/index.md) for everything else.
