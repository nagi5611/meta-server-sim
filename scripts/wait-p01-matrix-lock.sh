#!/usr/bin/env bash
# bc 行列と競合しないよう、ロック解放まで待つ（kill しない）
set -euo pipefail
LOCK="${METASIM_AIRCRAFT_MATRIX_LOCK:-/tmp/p01-aircraft-scenario-matrix.lock}"
WAIT_SEC="${1:-7200}"
end=$((SECONDS + WAIT_SEC))
while (( SECONDS < end )); do
  if ! fuser "$LOCK" >/dev/null 2>&1; then
    echo "matrix lock free"
    exit 0
  fi
  echo "matrix lock busy; waiting..."
  sleep 30
done
echo "timeout waiting for matrix lock" >&2
exit 1