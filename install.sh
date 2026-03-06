#!/bin/sh
set -e

REPO="dazzle-labs/cli"
INSTALL_DIR="${INSTALL_DIR:-/usr/local/bin}"

# Detect OS
OS=$(uname -s | tr '[:upper:]' '[:lower:]')
case "$OS" in
  linux)  OS="Linux" ;;
  darwin) OS="Darwin" ;;
  *)      echo "Unsupported OS: $OS" >&2; exit 1 ;;
esac

# Detect arch
ARCH=$(uname -m)
case "$ARCH" in
  x86_64 | amd64)  ARCH="x86_64" ;;
  arm64 | aarch64) ARCH="arm64" ;;
  *) echo "Unsupported architecture: $ARCH" >&2; exit 1 ;;
esac

# Get latest release tag
TAG=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" | grep '"tag_name"' | sed 's/.*"tag_name": *"\([^"]*\)".*/\1/')
if [ -z "$TAG" ]; then
  echo "Failed to fetch latest release" >&2
  exit 1
fi

URL="https://github.com/${REPO}/releases/download/${TAG}/dazzle_${OS}_${ARCH}"

echo "Installing dazzle ${TAG} (${OS}/${ARCH})..."

curl -fsSL "$URL" -o /tmp/dazzle
chmod +x /tmp/dazzle

if [ ! -w "$INSTALL_DIR" ]; then
  echo "sudo required to write to $INSTALL_DIR (you may be prompted for your password)"
  sudo mv /tmp/dazzle "$INSTALL_DIR/dazzle"
else
  mv /tmp/dazzle "$INSTALL_DIR/dazzle"
fi

echo "Installed to $INSTALL_DIR/dazzle"
echo "Run 'dazzle login' to get started."
