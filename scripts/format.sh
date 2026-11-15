#!/usr/bin/env bash

set -Eeuo pipefail

# ==========================================
# Format the code with Prettier.
# ==========================================

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/run-node.sh" 'npm ci && npm run format'
