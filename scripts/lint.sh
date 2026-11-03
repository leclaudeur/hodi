#!/usr/bin/env bash

set -Eeuo pipefail

# ==========================================
# Type-check, lint and check formatting.
# ==========================================

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"

"$SCRIPT_DIR/run-node.sh" 'npm ci && npm run typecheck && npm run lint && npm run format:check'
