#!/usr/bin/env bash
# Update pi-child-agent to latest version
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

echo "==> Updating pi-child-agent..."

# Re-run install from current source
bash "${SCRIPT_DIR}/install.sh"

echo "==> Update complete."
