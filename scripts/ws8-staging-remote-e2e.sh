#!/usr/bin/env bash
# WS-8: staging ホスト上で Playwright（127.0.0.1:3104）と API スモークを実行
set -euo pipefail
STAGING="${METASIM_STAGING_DIR:-/home/nagi/sim-server/meta-server-sim-staging}"
PORT="${METASIM_STAGING_PORT:-3104}"
BASE="http://127.0.0.1:${PORT}"
ART="${ARTIFACT_DIR:-/tmp/ws8-artifacts}"
PUBLIC_BASE="${WS8_STAGING_PUBLIC_URL:-https://staging.mmh-virtual.jp:3104}"
CURL_TLS=( -H "X-Forwarded-Proto: https" -H "Host: staging.mmh-virtual.jp" )
mkdir -p "$ART"

cd "$STAGING"
export METASIM_REMOTE_PORT="$PORT"
export PLAYWRIGHT_FORWARD_HOST="staging.mmh-virtual.jp"
export E2E_BASE_URL="http://127.0.0.1:${PORT}"
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0

echo "=== API checks $BASE ==="
curl -sf "$BASE/api/health" >/dev/null
curl -sf "${CURL_TLS[@]}" "$BASE/meta-server/api/worlds" | tee "$ART/meta-server-worlds.json" | head -c 200
echo
curl -sf "${CURL_TLS[@]}" -o /dev/null -w "monument=%{http_code}\n" "$BASE/meta-server/models/monument.glb"
curl -sf "${CURL_TLS[@]}" "$BASE/meta-server/api/charts" | head -c 120
echo
curl -sf "${CURL_TLS[@]}" "$BASE/meta-server/api/addons/enabled" | tee "$ART/meta-server-addons.json"
echo
BGM="$(curl -sf "${CURL_TLS[@]}" "$BASE/meta-server/api/charts" | node -pe 'const o=JSON.parse(require("fs").readFileSync(0,"utf8"));Object.keys(o)[0]||""' 2>/dev/null || true)"
if [ -n "$BGM" ]; then
  curl -sf "${CURL_TLS[@]}" -o /dev/null -w "bgm=%{http_code}\n" "$BASE/meta-server/chart-bgm/${BGM}.mp3" || true
fi

printf '%s\n' "$PUBLIC_BASE/meta-server/" >"$ART/staging-meta-server-entry.url.txt"
printf '%s\n' "$PUBLIC_BASE/P-01/" >"$ART/staging-p01-entry.url.txt"

npx playwright install chromium 2>/dev/null || true
ARTIFACT_DIR="$ART" npx playwright test --config=playwright.staging-remote.config.js 2>&1 | tee "$ART/tenant-taiko-playwright.log"
ARTIFACT_DIR="$ART" node scripts/ws9-taiko-playwright-smoke.mjs
ARTIFACT_DIR="$ART" node scripts/staging-meta-portal-e2e.mjs 2>&1 | tee "$ART/staging-portal-e2e.log"

for t in P-01 P-02 P-03; do
  chart="$(curl -sf "${CURL_TLS[@]}" "$BASE/$t/api/client-config" | node -pe "const j=JSON.parse(require('fs').readFileSync(0,'utf8'));j.chartFeaturesEnabled===true?'BAD':'ok'")"
  echo "$t client-config chartFeatures: $chart"
  test "$chart" = "ok"
done

echo "artifacts in $ART"