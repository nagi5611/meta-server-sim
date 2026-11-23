#!/usr/bin/env bash
# 本番ホスト上で xvfb+headed キャリブ（行列ロック排他）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ART="${MCP_ARTIFACTS_DIR:-/home/nagi/sim-server/backups/mcp-artifacts/b0586736-repro}"
LOCK="${METASIM_AIRCRAFT_MATRIX_LOCK:-/tmp/p01-aircraft-scenario-matrix.lock}"
mkdir -p "$ART"
export PLAYWRIGHT_HEADED=1 MCP_SCENARIO_HEADED=1 MCP_ARTIFACTS_DIR="$ART" AIRCRAFT_SCENARIO_ARTIFACTS="$ART"
export E2E_BASE_URL="${E2E_BASE_URL:-https://sim.mmh-virtual.jp}"
FILES=(
  p01-straight.json p01-yaw-right.json p01-climb.json p01-combo.json
  p01-b787-straight.json p01-b787-yaw-right.json p01-b787-climb.json
)
exec flock -w 7200 "$LOCK" bash -c "
  set -euo pipefail
  cd \"$ROOT\"
  xvfb-run -a node scripts/prod-p01-guest-lobby-headed-check.mjs || true
  for f in ${FILES[*]}; do
    id=\${f%.json}
    xvfb-run -a node scripts/aircraft-scenario.mjs \"scenarios/aircraft/\$f\" --out \"$ART/calib-\$id.json\" || true
    sleep 8
  done
  echo CALIB_DONE > \"$ART/calib-status.txt\"
"