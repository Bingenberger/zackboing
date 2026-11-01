#!/usr/bin/env bash
# Vom Arbeitsrechner aus: ./deploy/deploy.sh root@server
# Kopiert den Code auf den Server und führt dort deploy/install.sh aus.
set -euo pipefail
TARGET="${1:?Aufruf: deploy.sh user@server}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ Code nach $TARGET:/tmp/zackboing-upload kopieren"
rsync -az --delete \
  --exclude node_modules --exclude data --exclude .claude --exclude '.git*' \
  "$HERE"/ "$TARGET":/tmp/zackboing-upload/

echo "→ Installation auf dem Server"
ssh "$TARGET" 'bash /tmp/zackboing-upload/deploy/install.sh /tmp/zackboing-upload && rm -rf /tmp/zackboing-upload'
