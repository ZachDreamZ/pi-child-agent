#!/usr/bin/env bash
# Install pi-child-agent extension for Pi (Linux/macOS)
set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PI_EXT_DIR="${HOME}/.pi/agent/extensions/pi-child-agent"

echo "==> Installing pi-child-agent..."
echo "    Source: ${SOURCE_DIR}"
echo "    Destination: ${PI_EXT_DIR}"

mkdir -p "${PI_EXT_DIR}"

# Copy files (exclude node_modules, .git, dist)
rsync -av --exclude='node_modules' --exclude='.git' --exclude='dist' \
  "${SOURCE_DIR}/" "${PI_EXT_DIR}/" 2>/dev/null || \
  cp -r "${SOURCE_DIR}/" "${PI_EXT_DIR}/" 2>/dev/null || {
    # Fallback: manual copy
    for f in "${SOURCE_DIR}"/*; do
      [ -d "$f" ] && [ "$(basename "$f")" = "node_modules" ] && continue
      [ -d "$f" ] && [ "$(basename "$f")" = ".git" ] && continue
      [ -d "$f" ] && [ "$(basename "$f")" = "dist" ] && continue
      cp -r "$f" "${PI_EXT_DIR}/"
    done
  }

cd "${PI_EXT_DIR}"
npm install --omit=dev
echo "==> pi-child-agent installed successfully!"
echo "    Restart Pi or run /reload to load the extension."
