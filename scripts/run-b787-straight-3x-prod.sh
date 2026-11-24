#!/usr/bin/env bash
# 本番ホストで B787 straight を headed 3 連続 + 飛行スクショ
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
ART="${MCP_ARTIFACTS_DIR:-/home/nagi/sim-server/backups/mcp-artifacts/b787-straight-3x}"
LOCK="${METASIM_AIRCRAFT_MATRIX_LOCK:-/tmp/p01-aircraft-scenario-matrix.lock}"
mkdir -p "$ART"
export PLAYWRIGHT_HEADED=1 MCP_SCENARIO_HEADED=1 MCP_ARTIFACTS_DIR="$ART" AIRCRAFT_SCENARIO_ARTIFACTS="$ART"
export E2E_BASE_URL="${E2E_BASE_URL:-https://sim.mmh-virtual.jp}"
# 外側 flock で本スクリプトを包むと wait が自己待ちになるため、ロック取得は exec flock のみ
exec flock -w 7200 "$LOCK" bash -c "
  set -euo pipefail
  cd \"$ROOT\"
  for run in 1 2 3; do
    xvfb-run -a node scripts/aircraft-scenario.mjs scenarios/aircraft/p01-b787-straight.json --out \"$ART/b787-straight-run\${run}.json\" || true
    sleep 60
  done
  xvfb-run -a node scripts/prod-aircraft-flying-screenshot.mjs
"