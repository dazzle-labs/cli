#!/bin/bash
# Setup GitHub Actions secrets for browser-streamer CI/CD.
# Copies reusable secrets from dazzle-labs/axis-router and sets known values.
#
# Prerequisites:
#   - gh CLI authenticated
#   - Access to dazzle-labs/axis-router repo
#
# Usage: ./scripts/setup-secrets.sh

set -euo pipefail

REPO="dazzle-labs/browser-streamer"
SOURCE_REPO="dazzle-labs/axis-router"

echo "=== Copying secrets from ${SOURCE_REPO} ==="

for secret in DOCKERHUB_USERNAME DOCKERHUB_TOKEN AGE_SECRET_KEY DISCORD_DEPLOY_WEBHOOK_URL; do
  echo "  Copying ${secret}..."
  gh secret list -R "$SOURCE_REPO" --json name -q ".[].name" | grep -q "^${secret}$" || {
    echo "  WARNING: ${secret} not found in ${SOURCE_REPO}, skipping"
    continue
  }
  # gh doesn't support reading secret values — user must copy manually or use:
  # gh api repos/${SOURCE_REPO}/actions/secrets doesn't return values either.
  # Instead, we rely on the secrets being set identically.
  echo "  NOTE: Cannot programmatically copy secret values via gh CLI."
  echo "        Please manually copy ${secret} from ${SOURCE_REPO} to ${REPO}."
done

echo ""
echo "=== Setting known values ==="

echo "  Setting VITE_CLERK_PUBLISHABLE_KEY..."
gh secret set VITE_CLERK_PUBLISHABLE_KEY -R "$REPO" --body "pk_live_Y2xlcmsuZGF6emxlLmZtJA"

echo ""
echo "=== Manual steps required ==="
echo ""
echo "1. Copy the following secrets from ${SOURCE_REPO} → ${REPO}:"
echo "   (GitHub doesn't expose secret values via API — copy from Settings > Secrets)"
echo ""
echo "   - DOCKERHUB_USERNAME"
echo "   - DOCKERHUB_TOKEN"
echo "   - AGE_SECRET_KEY"
echo "   - DISCORD_DEPLOY_WEBHOOK_URL"
echo ""
echo "2. Set K3S_KUBECONFIG manually:"
echo "   Copy kubeconfig from the browser-streamer k3s cluster and set it:"
echo ""
echo "     gh secret set K3S_KUBECONFIG -R ${REPO} < /path/to/kubeconfig"
echo ""
echo "3. Create the Docker Hub pull secret for k8s:"
echo "   Decrypt from axis-router, change namespace, re-encrypt:"
echo ""
echo "     cd /path/to/axis-router"
echo "     sops -d k8s/secrets/dockerhub-secret.yaml | \\"
echo "       sed 's/namespace: default/namespace: browser-streamer/' | \\"
echo "       sops -e --input-type yaml --output-type yaml \\"
echo "         --encrypted-regex '^(data|stringData)\$' \\"
echo "         --age 'age1ase59dknkacq26gemrs9dvwvu8xr8akhfya99lagv5py7c7h7plsmtucvv,age13zs054me9k5h4m8u3hwqw9nz4jg6lkpfmkzqn8mdujjqp76h6plsmlmtpy,age17ttan4es6923ru96408ctjhs2f97mrxq9uw938plgnw6wkstv9cqsaq5cw,age1un8ajg06rd075pff8pglkq2q0g020peq7v23qzeqhuchl4y4kyfs0drxyf' \\"
echo "         /dev/stdin > /path/to/browser-streamer/k8s/secrets/dockerhub-secret.yaml"
echo ""
echo "Verify with: gh secret list -R ${REPO}"
