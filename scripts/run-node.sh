#!/usr/bin/env bash

set -Eeuo pipefail

# ==========================================
# Run a command in an ephemeral Node.js container.
# Node.js and npm are not installed on the host.
# ==========================================

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd -- "$SCRIPT_DIR/.." && pwd)"

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 '<command>'" >&2
  exit 1
fi

docker run --rm \
  --user "$(id -u):$(id -g)" \
  --env HOME=/tmp \
  --volume "$REPO_DIR:/workspace" \
  --workdir /workspace \
  node:24-alpine \
  sh -c "$1"
