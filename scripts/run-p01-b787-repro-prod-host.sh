#!/usr/bin/env bash
# B787 のみ 3 連続（A320 は bc 行列と競合しないよう分離）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ART="${MCP_ARTIFACTS_DIR:-/home/nagi/sim-server/backups/mcp-artifacts/b0586736-repro}"
LOCK="${METASIM_AIRCRAFT_MATRIX_LOCK:-/tmp/p01-aircraft-scenario-matrix.lock}"
mkdir -p "$ART"
export PLAYWRIGHT_HEADED=1 MCP_SCENARIO_HEADED=1 MCP_ARTIFACTS_DIR="$ART" AIRCRAFT_SCENARIO_ARTIFACTS="$ART"
export E2E_BASE_URL=https://sim.mmh-virtual.jp
FILES=(p01-b787-straight.json p01-b787-yaw-right.json p01-b787-climb.json)
exec flock -w 7200 "$LOCK" bash -c "
  set -euo pipefail
  cd \"$ROOT\"
  for f in ${FILES[*]}; do
    for run in 1 2 3; do
      id=\${f%.json}
      xvfb-run -a node scripts/aircraft-scenario.mjs \"scenarios/aircraft/\$f\" --out \"$ART/repro-\$id-run\$run.json\"
      sleep 5
    done
  done
  xvfb-run -a node scripts/prod-aircraft-flying-screenshot.mjs
"