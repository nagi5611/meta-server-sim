#!/usr/bin/env bash
# 本番: B787 straight を計測用 5 回（checkpoint なしの一時 JSON は使わず本番シナリオで samples のみ評価）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ART="${MCP_ARTIFACTS_DIR:-/home/nagi/sim-server/backups/mcp-artifacts/b787-calibrate}"
LOCK="${METASIM_AIRCRAFT_MATRIX_LOCK:-/tmp/p01-aircraft-scenario-matrix.lock}"
mkdir -p "$ART"
export PLAYWRIGHT_HEADED=1 MCP_SCENARIO_HEADED=1 MCP_ARTIFACTS_DIR="$ART" AIRCRAFT_SCENARIO_ARTIFACTS="$ART"
export E2E_BASE_URL="${E2E_BASE_URL:-https://sim.mmh-virtual.jp}"
"$ROOT/scripts/wait-p01-matrix-lock.sh" 7200 || true
exec flock -w 7200 "$LOCK" bash -c "
  set -euo pipefail
  cd \"$ROOT\"
  for run in 1 2 3 4 5; do
    out=\"${ART}/calib-run\${run}.json\"
    xvfb-run -a node scripts/aircraft-scenario.mjs scenarios/aircraft/p01-b787-straight-calibrate.json --out \"\${out}\" || true
    sleep 45
  done
"
echo \"calibration artifacts in ${ART}\"