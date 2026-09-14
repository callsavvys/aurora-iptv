#!/bin/bash
# Runs tests/two-devices.cjs as four launches: A1, B1, A2, B2.
set -uo pipefail
cd "$(dirname "$0")/.."
: "${AURORA_TEST_EMAIL:?set AURORA_TEST_EMAIL}" "${AURORA_TEST_PASSWORD:?set AURORA_TEST_PASSWORD}"
WORK="$(mktemp -d)"
export DEVICE_A_DIR="$WORK/a" DEVICE_B_DIR="$WORK/b"
status=0
for step in A1 B1 A2 B2; do
  echo "== $step"
  STEP=$step npx electron tests/two-devices.cjs 2>/dev/null | grep -E "^  ok|^FAIL|passed|failed" || status=1
  [ "${PIPESTATUS[0]}" = "0" ] || status=1
done
rm -rf "$WORK"
exit $status
