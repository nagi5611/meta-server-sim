#!/usr/bin/env bash
# WS-8: 本番 sim ホスト上の API + Playwright（sim.mmh-virtual.jp）
set -euo pipefail
PROD="${METASIM_PROD_DIR:-/home/nagi/sim-server/meta-server-sim}"
PORT="${METASIM_PROD_PORT:-3004}"
METASIM_REMOTE_PORT="$PORT"
export METASIM_REMOTE_PORT
export PLAYWRIGHT_FORWARD_HOST="sim.mmh-virtual.jp"
BASE="http://127.0.0.1:${PORT}"
PUBLIC_SIM="${WS8_PROD_PUBLIC_URL:-https://sim.mmh-virtual.jp}"
PUBLIC_LOBBY="${WS8_LOBBY_PUBLIC_URL:-https://m.mmh-virtual.jp}"
ART="${ARTIFACT_DIR:-/tmp/ws8-prod-artifacts}"
CURL_TLS=( -H "X-Forwarded-Proto: https" -H "Host: sim.mmh-virtual.jp" )
mkdir -p "$ART"

cd "$PROD"
export E2E_BASE_URL="http://127.0.0.1:${PORT}"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0

echo "=== API checks $BASE ==="
curl -sf "$BASE/api/health" >/dev/null
curl -sf "${CURL_TLS[@]}" "$BASE/meta-server/api/worlds" | tee "$ART/prod-meta-server-worlds.json" | head -c 200
echo
curl -sf "${CURL_TLS[@]}" -o /dev/null -w "monument=%{http_code}\n" "$BASE/meta-server/models/monument.glb"
curl -sf "${CURL_TLS[@]}" "$BASE/meta-server/api/charts" | head -c 120
echo
curl -sf "${CURL_TLS[@]}" "$BASE/meta-server/api/addons/enabled" | tee "$ART/prod-meta-server-addons.json"
echo

BGM="$(curl -sf "${CURL_TLS[@]}" "$BASE/meta-server/api/charts" | node -pe 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));Object.keys(o)[0]||""' 2>/dev/null || true)"
if [ -n "$BGM" ]; then
  curl -sf "${CURL_TLS[@]}" -o /dev/null -w "bgm=%{http_code}\n" "$BASE/meta-server/chart-bgm/${BGM}.mp3" || true
fi

printf '%s\n' "$PUBLIC_SIM/meta-server/" >"$ART/prod-meta-server-entry.url.txt"
printf '%s\n' "$PUBLIC_LOBBY/" >"$ART/prod-lobby-entry.url.txt"

npx playwright install chromium 2>/dev/null || true
ARTIFACT_DIR="$ART" npx playwright test --config=playwright.staging-remote.config.js 2>&1 | tee "$ART/prod-tenant-taiko-playwright.log"

ARTIFACT_DIR="$ART" node scripts/ws9-taiko-playwright-smoke.mjs 2>&1 | tee -a "$ART/prod-ws9-smoke.log"

for t in P-01 P-02 P-03; do
  chart="$(curl -sf "${CURL_TLS[@]}" "$BASE/$t/api/client-config" | node -pe "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));j.chartFeaturesEnabled===true?'BAD':'ok'")"
  echo "$t chartFeatures: $chart"
  test "$chart" = "ok"
  curl -sf "${CURL_TLS[@]}" -o /dev/null -w "${t}_health=%{http_code}\n" "$BASE/$t/"
done

echo "artifacts: $ART"