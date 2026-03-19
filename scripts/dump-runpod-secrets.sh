#!/usr/bin/env bash
# Extracts secret values from the prod k8s cluster for creating RunPod secrets.
#
# Run from the repo root:
#   bash scripts/dump-runpod-secrets.sh
#
# Create each secret in the RunPod console (https://www.runpod.io/console/secrets)
# using the exact name and value printed below.
set -euo pipefail

NS="browser-streamer"

get_secret() {
  local secret="$1" key="$2"
  make prod/kubectl ARGS="get secret $secret -n $NS -o json" 2>/dev/null \
    | jq -r ".data[\"$key\"]" \
    | base64 -d
}

print_secret() {
  local runpod_name="$1" k8s_secret="$2" k8s_key="$3"
  echo "──────────────────────────────────────"
  echo "RunPod secret name: $runpod_name"
  echo "Source: k8s secret '$k8s_secret' key '$k8s_key'"
  echo ""
  get_secret "$k8s_secret" "$k8s_key" || echo "(failed to extract)"
  echo ""
}

echo "=== RunPod Secrets ==="
echo ""
echo "Create each in RunPod console → Secrets → Create Secret"
echo "Copy the exact name and paste the value below it."
echo ""

print_secret "mtls_server_cert"     "dazzle-mtls"    "server.crt"
print_secret "mtls_server_key"      "dazzle-mtls"    "server.key"
print_secret "mtls_ca_cert"         "dazzle-mtls"    "ca.crt"
print_secret "r2_access_key_id"     "r2-credentials" "access_key_id"
print_secret "r2_secret_access_key" "r2-credentials" "secret_access_key"
