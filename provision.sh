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
${SSH} "curl -sfL https://get.k3s.io | sh -"

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
echo "==> Building streamer image on streamer..."
${SSH} "rm -rf /tmp/browser-streamer-build && mkdir -p /tmp/browser-streamer-build"
scp -r streamer/ "root@${HOST}:/tmp/browser-streamer-build/"
${SSH} "cd /tmp/browser-streamer-build && buildctl build \
    --frontend=dockerfile.v0 \
    --local context=streamer \
    --local dockerfile=streamer/docker \
    --opt filename=Dockerfile \
    --output type=oci,dest=/tmp/browser-streamer.tar,name=docker.io/library/browser-streamer:latest"

echo "==> Importing streamer image into k3s containerd..."
${SSH} "k3s ctr images import /tmp/browser-streamer.tar"

# Step 8: Build control-plane image
echo "==> Building control-plane image on streamer..."
${SSH} "rm -rf /tmp/control-plane-build && mkdir -p /tmp/control-plane-build"
scp -r control-plane/ web/ "root@${HOST}:/tmp/control-plane-build/"
scp control-plane/docker/Dockerfile "root@${HOST}:/tmp/control-plane-build/Dockerfile"
${SSH} "cd /tmp/control-plane-build && buildctl build \
    --frontend=dockerfile.v0 \
    --local context=. \
    --local dockerfile=. \
    --opt filename=Dockerfile \
    --output type=oci,dest=/tmp/control-plane.tar,name=docker.io/library/control-plane:latest"

echo "==> Importing control-plane image into k3s containerd..."
${SSH} "k3s ctr images import /tmp/control-plane.tar"

# Step 9: Remove old streamer deployment (replaced by control-plane)
echo "==> Cleaning up old streamer resources..."
${SSH} "k3s kubectl delete deployment streamer -n browser-streamer --ignore-not-found"
${SSH} "k3s kubectl delete service streamer -n browser-streamer --ignore-not-found"
${SSH} "k3s kubectl delete hpa streamer -n browser-streamer --ignore-not-found"

# Step 10: Deploy control-plane with RBAC
echo "==> Deploying control-plane RBAC..."
${SSH} "k3s kubectl apply -f -" < control-plane/k8s/rbac.yaml

echo "==> Deploying control-plane..."
${SSH} "k3s kubectl apply -f -" < control-plane/k8s/deployment.yaml
${SSH} "k3s kubectl apply -f -" < control-plane/k8s/service.yaml

# Step 11: Wait for control-plane to be ready
echo "==> Waiting for control-plane to be ready..."
${SSH} "k3s kubectl rollout status deployment/control-plane -n browser-streamer --timeout=120s"

# Step 12: Install cert-manager
echo "==> Installing cert-manager..."
${SSH} "k3s kubectl apply -f https://github.com/cert-manager/cert-manager/releases/latest/download/cert-manager.yaml"
${SSH} "k3s kubectl rollout status deployment/cert-manager -n cert-manager --timeout=120s"
${SSH} "k3s kubectl rollout status deployment/cert-manager-webhook -n cert-manager --timeout=120s"
${SSH} "k3s kubectl rollout status deployment/cert-manager-cainjector -n cert-manager --timeout=120s"

# Step 13: Setup TLS (Traefik config, ClusterIssuer, Ingress)
echo "==> Setting up TLS..."
${SSH} "k3s kubectl apply -f -" < k8s/networking/traefik-config.yaml
${SSH} "k3s kubectl apply -f -" < k8s/networking/cluster-issuer.yaml
${SSH} "k3s kubectl apply -f -" < k8s/networking/ingress.yaml

# Step 14: Verify
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
echo "Session Manager (via Traefik + TLS):"
echo "  Health:      curl https://stream.dazzle.fm/health"
echo "  New session: curl -X POST https://stream.dazzle.fm/api/session?token=${TOKEN}"
echo "  Sessions:    curl https://stream.dazzle.fm/api/sessions?token=${TOKEN}"
echo "  Dashboard:   https://stream.dazzle.fm/"
echo ""
echo "NOTE: Ensure DNS A record for stream.dazzle.fm points to ${HOST}"
echo "      Certificate will be auto-provisioned by cert-manager on first request."
