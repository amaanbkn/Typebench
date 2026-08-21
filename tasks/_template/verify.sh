#!/usr/bin/env bash
set -euo pipefail

echo "[Typebench] Running task verification..."

# 1. Check TypeScript compilation
if command -v npx >/dev/null 2>&1; then
  echo "==> Running type checking..."
  npx tsc --noEmit
fi

# 2. Run targeted test suite
echo "==> Running automated test runner..."
npm test

echo "[Typebench] All verification checks PASSED successfully."
exit 0
