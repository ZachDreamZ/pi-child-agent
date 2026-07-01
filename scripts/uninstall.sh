#!/usr/bin/env bash
# Uninstall pi-child-agent extension
set -euo pipefail

PI_EXT_DIR="${HOME}/.pi/agent/extensions/pi-child-agent"

if [ -d "${PI_EXT_DIR}" ]; then
  echo "==> Removing pi-child-agent from ${PI_EXT_DIR}"
  rm -rf "${PI_EXT_DIR}"
  echo "==> Uninstalled successfully."
else
  echo "==> pi-child-agent is not installed."
fi
