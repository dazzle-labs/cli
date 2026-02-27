#!/usr/bin/env bash
set -euo pipefail

# Provision a fresh host with k3s + session-managed browser streaming
# Usage: ./provision.sh <host-ip> [token]
#
# Examples:
#   ./provision.sh 5.78.145.53                     # generates a random token
#   ./provision.sh 5.78.145.53 my-secret-token     # uses provided token

HOST="${1:?Usage: ./provision.sh <host-ip> [token]}"
TOKEN="${2:-$(openssl rand -hex 32)}"
SSH="ssh root@${HOST}"

echo "==> Provisioning ${HOST}"
echo "==> Token: ${TOKEN}"

# Step 1: Install k3s
echo "==> Installing k3s..."
${SSH} "curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC='--disable=traefik' sh -"

# Wait for k3s to be ready
echo "==> Waiting for k3s node to be ready..."
${SSH} "until k3s kubectl get node | grep -q ' Ready'; do sleep 2; done"

# Step 2: Apply namespace
echo "==> Creating namespace..."
${SSH} "k3s kubectl apply -f -" < k8s/namespace.yaml

# Step 3: Create secret with token
echo "==> Creating auth secret..."
${SSH} "k3s kubectl create secret generic browserless-auth \
  --namespace=browser-streamer \
  --from-literal=token=${TOKEN} \
  --dry-run=client -o yaml | k3s kubectl apply -f -"

# Step 4: Deploy browserless
echo "==> Deploying browserless..."
${SSH} "k3s kubectl apply -f -" < k8s/browserless-deployment.yaml
${SSH} "k3s kubectl apply -f -" < k8s/browserless-service.yaml
${SSH} "k3s kubectl apply -f -" < k8s/browserless-hpa.yaml

# Step 5: Wait for browserless pods to be ready
echo "==> Waiting for browserless pods to be ready..."
${SSH} "k3s kubectl rollout status deployment/browserless -n browser-streamer --timeout=120s"

# Step 6: Install buildkit (needed to build container images without Docker)
echo "==> Ensuring buildkit is installed and running..."
${SSH} 'command -v buildkitd || {
    BUILDKIT_VERSION=0.13.2
    curl -fsSL "https://github.com/moby/buildkit/releases/download/v${BUILDKIT_VERSION}/buildkit-v${BUILDKIT_VERSION}.linux-amd64.tar.gz" | tar -xz -C /usr/local
}'
${SSH} 'pgrep buildkitd || { buildkitd --addr unix:///run/buildkit/buildkitd.sock &>/var/log/buildkitd.log & sleep 2; }'

# Step 7: Build streamer image
echo "==> Building streamer image on server..."
${SSH} "rm -rf /tmp/browser-streamer-build && mkdir -p /tmp/browser-streamer-build"
scp -r docker/ server/ "root@${HOST}:/tmp/browser-streamer-build/"
${SSH} "cd /tmp/browser-streamer-build && buildctl build \
    --frontend=dockerfile.v0 \
    --local context=. \
    --local dockerfile=docker \
    --opt filename=Dockerfile \
    --output type=oci,dest=/tmp/browser-streamer.tar,name=docker.io/library/browser-streamer:latest"

echo "==> Importing streamer image into k3s containerd..."
${SSH} "k3s ctr images import /tmp/browser-streamer.tar"

# Step 8: Build session-manager image
echo "==> Building session-manager image on server..."
${SSH} "rm -rf /tmp/session-manager-build && mkdir -p /tmp/session-manager-build"
scp -r session-manager/ viewer.html "root@${HOST}:/tmp/session-manager-build/"
scp docker/Dockerfile.session-manager "root@${HOST}:/tmp/session-manager-build/Dockerfile"
${SSH} "cd /tmp/session-manager-build && buildctl build \
    --frontend=dockerfile.v0 \
    --local context=. \
    --local dockerfile=. \
    --opt filename=Dockerfile \
    --output type=oci,dest=/tmp/session-manager.tar,name=docker.io/library/session-manager:latest"

echo "==> Importing session-manager image into k3s containerd..."
${SSH} "k3s ctr images import /tmp/session-manager.tar"

# Step 9: Remove old streamer deployment (replaced by session-manager)
echo "==> Cleaning up old streamer resources..."
${SSH} "k3s kubectl delete deployment streamer -n browser-streamer --ignore-not-found"
${SSH} "k3s kubectl delete service streamer -n browser-streamer --ignore-not-found"
${SSH} "k3s kubectl delete hpa streamer -n browser-streamer --ignore-not-found"

# Step 10: Deploy session-manager with RBAC
echo "==> Deploying session-manager RBAC..."
${SSH} "k3s kubectl apply -f -" < k8s/session-manager-rbac.yaml

echo "==> Deploying session-manager..."
${SSH} "k3s kubectl apply -f -" < k8s/session-manager-deployment.yaml
${SSH} "k3s kubectl apply -f -" < k8s/session-manager-service.yaml

# Step 11: Wait for session-manager to be ready
echo "==> Waiting for session-manager to be ready..."
${SSH} "k3s kubectl rollout status deployment/session-manager -n browser-streamer --timeout=120s"

# Step 12: Verify
echo "==> Verifying..."
echo ""
echo "Pods:"
${SSH} "k3s kubectl get pods -n browser-streamer"
echo ""
echo "Services:"
${SSH} "k3s kubectl get svc -n browser-streamer"
echo ""
echo "==> Done!"
echo ""
echo "Browserless:"
echo "  CDP:  ws://${HOST}:30000?token=${TOKEN}"
echo "  HTTP: http://${HOST}:30000?token=${TOKEN}"
echo ""
echo "Session Manager:"
echo "  Health:      curl http://${HOST}:30080/health"
echo "  New session: curl -X POST http://${HOST}:30080/api/session?token=${TOKEN}"
echo "  Sessions:    curl http://${HOST}:30080/api/sessions?token=${TOKEN}"
echo "  Viewer:      http://${HOST}:30080/"
echo ""
echo "Direct access (after creating a session):"
echo "  CDP:  ws://${HOST}:<directPort>?token=${TOKEN}"
echo "  HLS:  http://${HOST}:<directPort>/hls/stream.m3u8?token=${TOKEN}"
