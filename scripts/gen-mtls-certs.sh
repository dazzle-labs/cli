#!/usr/bin/env bash
set -euo pipefail

# Generate mTLS certificates for control-plane ↔ sidecar communication
# on RunPod GPU nodes. Outputs a SOPS-encrypted k8s secret file.
#
# Usage:
#   scripts/gen-mtls-certs.sh              # generates certs, writes sops file (skips if exists)
#   scripts/gen-mtls-certs.sh --force      # regenerates even if file exists

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_FILE="$REPO_ROOT/k8s/secrets/dazzle-mtls.secrets.yaml"
NAMESPACE="browser-streamer"
VALIDITY_DAYS=730  # 2 years

FORCE=false
if [[ "${1:-}" == "--force" ]]; then
    FORCE=true
fi

if [[ -f "$OUTPUT_FILE" ]] && [[ "$FORCE" = false ]]; then
    echo "File $OUTPUT_FILE already exists."
    echo "Use --force to regenerate (WARNING: breaks existing RunPod pods)."
    exit 0
fi

TMPDIR=$(mktemp -d)
trap 'rm -rf "$TMPDIR"' EXIT

echo "Generating CA..."
openssl ecparam -genkey -name prime256v1 -out "$TMPDIR/ca.key" 2>/dev/null
openssl req -new -x509 -key "$TMPDIR/ca.key" \
    -out "$TMPDIR/ca.crt" \
    -days "$VALIDITY_DAYS" \
    -subj "/CN=dazzle-mtls-ca" \
    2>/dev/null

echo "Generating server certificate..."
openssl ecparam -genkey -name prime256v1 -out "$TMPDIR/server.key" 2>/dev/null
openssl req -new -key "$TMPDIR/server.key" \
    -out "$TMPDIR/server.csr" \
    -subj "/CN=dazzle-sidecar" \
    2>/dev/null
openssl x509 -req -in "$TMPDIR/server.csr" \
    -CA "$TMPDIR/ca.crt" -CAkey "$TMPDIR/ca.key" \
    -CAcreateserial \
    -out "$TMPDIR/server.crt" \
    -days "$VALIDITY_DAYS" \
    2>/dev/null

echo "Generating client certificate..."
openssl ecparam -genkey -name prime256v1 -out "$TMPDIR/client.key" 2>/dev/null
openssl req -new -key "$TMPDIR/client.key" \
    -out "$TMPDIR/client.csr" \
    -subj "/CN=dazzle-control-plane" \
    2>/dev/null
openssl x509 -req -in "$TMPDIR/client.csr" \
    -CA "$TMPDIR/ca.crt" -CAkey "$TMPDIR/ca.key" \
    -CAcreateserial \
    -out "$TMPDIR/client.crt" \
    -days "$VALIDITY_DAYS" \
    2>/dev/null

echo "Writing SOPS-encrypted secret to $OUTPUT_FILE..."
cat > "$TMPDIR/plain.yaml" <<EOF
apiVersion: v1
kind: Secret
metadata:
    name: dazzle-mtls
    namespace: $NAMESPACE
stringData:
    ca.crt: |
$(sed 's/^/        /' "$TMPDIR/ca.crt")
    server.crt: |
$(sed 's/^/        /' "$TMPDIR/server.crt")
    server.key: |
$(sed 's/^/        /' "$TMPDIR/server.key")
    client.crt: |
$(sed 's/^/        /' "$TMPDIR/client.crt")
    client.key: |
$(sed 's/^/        /' "$TMPDIR/client.key")
EOF

cp "$TMPDIR/plain.yaml" "$OUTPUT_FILE"
sops encrypt -i "$OUTPUT_FILE"

echo "Done. Encrypted secret written to $OUTPUT_FILE"
echo "Apply with: sops -d $OUTPUT_FILE | kubectl apply -f -"
