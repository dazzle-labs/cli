# CLAUDE.md

For complete architecture, build, deployment, and development guidance, see **[docs/index.md](docs/index.md)**.

## Make Commands

### Code Generation
```bash
make proto                  # Generate protobuf code (Go + TypeScript)
```

### Build (Remote via SSH)
```bash
make build                  # Build all images on remote host
make build-streamer         # Build streamer image
make build-control-plane    # Build control-plane image
```

### Deploy & Manage
```bash
make deploy                 # Apply k8s manifests + restart control-plane
make restart                # Restart control-plane pod (picks up new image)
make provision HOST=x.x.x.x [TOKEN=...] # Full provision from scratch
```

### Secrets & TLS
```bash
make secrets                # Decrypt and apply SOPS-encrypted secrets
make install-cert-manager   # Install cert-manager on cluster
make setup-tls              # Apply Traefik config, ClusterIssuer, Ingress
```

### Observe & Monitor
```bash
make status                 # Show pods, services, ingress, certificates
make logs-cp                # Tail control-plane logs
```

### Cleanup
```bash
make clean                  # Delete all session pods
```

### Component-Level (from root with / syntax)
```bash
# Control Plane
make control-plane/proto         # Generate protobuf
make control-plane/build         # Build control-plane
make control-plane/deploy        # Deploy control-plane k8s manifests
make control-plane/restart       # Restart control-plane pod
make control-plane/logs          # Tail control-plane logs

# Streamer
make streamer/build              # Build streamer image
make streamer/logs POD=<pod>     # Tail streamer pod

# Web
make web/build                   # Build web (Vite + React)
make web/dev                     # Dev server

# Or cd into component and run make directly
cd control-plane && make build   # Same as: make control-plane/build
cd streamer && make build        # Same as: make streamer/build
cd web && make build             # Same as: make web/build
```

### Configuration
```bash
# Set remote host and clerk key
make build HOST=x.x.x.x CLERK_PK=pk_live_...
```

See [docs/index.md](docs/index.md) for everything else.
