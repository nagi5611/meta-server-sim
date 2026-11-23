#!/usr/bin/env bash
# 本番マトリクス: xvfb + headed Playwright、flock で同時実行を排他（B787 検証と衝突回避）
set -euo pipefail

INSTALL_DIR="${METASIM_INSTALL_DIR:-/home/nagi/sim-server/meta-server-sim}"
LOCK="${METASIM_AIRCRAFT_MATRIX_LOCK:-/tmp/p01-aircraft-scenario-matrix-a320.lock}"
ARTIFACTS="${MCP_ARTIFACTS_DIR:-/home/nagi/sim-server/backups/mcp-artifacts}"
export MCP_SCENARIO_HEADED=1
export MCP_ARTIFACTS_DIR="$ARTIFACTS"
export AIRCRAFT_SCENARIO_BASE_URL="${AIRCRAFT_SCENARIO_BASE_URL:-https://sim.mmh-virtual.jp}"
export WORLD_EDIT_MCP_TENANT_ID=P-01
export MCP_MATRIX_MAX_ATTEMPTS="${MCP_MATRIX_MAX_ATTEMPTS:-5}"

exec flock -w 7200 "$LOCK" bash -c "
  set -euo pipefail
  cd \"$INSTALL_DIR\"
  command -v xvfb-run >/dev/null
  mkdir -p \"$ARTIFACTS\"
  HEAD=\$(git rev-parse HEAD)
  exec xvfb-run -a env MCP_SCENARIO_HEADED=1 MCP_ARTIFACTS_DIR=\"$ARTIFACTS\" METASIM_PROD_HEAD=\"\$HEAD\" \
    node scripts/mcp-aircraft-scenario-matrix.mjs
"