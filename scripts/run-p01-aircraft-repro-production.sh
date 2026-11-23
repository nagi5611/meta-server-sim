#!/usr/bin/env bash
# 本番 P-01: xvfb + headed、行列ロックを取得してから repro（B787 は bc 行列とスロット分離）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
MATRIX_LOCK="${METASIM_AIRCRAFT_MATRIX_LOCK:-/tmp/p01-aircraft-scenario-matrix.lock}"
export PLAYWRIGHT_HEADED=1
export MCP_SCENARIO_HEADED=1
export E2E_BASE_URL="${E2E_BASE_URL:-https://sim.mmh-virtual.jp}"
export AIRCRAFT_SCENARIO_ARTIFACTS="${AIRCRAFT_SCENARIO_ARTIFACTS:-/opt/cursor/artifacts}"
mkdir -p "$AIRCRAFT_SCENARIO_ARTIFACTS"

exec flock -w 7200 "$MATRIX_LOCK" bash -c "
  set -euo pipefail
  cd \"$ROOT\"
  xvfb-run -a node scripts/prod-p01-guest-lobby-headed-check.mjs
  xvfb-run -a node scripts/run-aircraft-scenario-repro.mjs
  xvfb-run -a node scripts/prod-aircraft-flying-screenshot.mjs
"