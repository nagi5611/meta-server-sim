#!/usr/bin/env bash
# Cloudflare 上に metaverse-lobby Worker を初回または更新デプロイする。
# 必要: CLOUDFLARE_API_TOKEN（Workers Scripts Edit + KV Edit + Account Read）
# 任意: CLOUDFLARE_ACCOUNT_ID, LOBBY_PRESENCE_SECRET, LOBBY_WORKER_SYNC_SECRET（未設定時は openssl で生成）
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOBBY_DIR="${ROOT}/metaverse-lobby"
WRANGLER_TOML="${LOBBY_DIR}/wrangler.toml"

log() { printf '[lobby-cf] %s\n' "$*"; }

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  log "ERROR: set CLOUDFLARE_API_TOKEN (Dashboard → My Profile → API Tokens)"
  exit 1
fi

export CLOUDFLARE_API_TOKEN
if [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  export CLOUDFLARE_ACCOUNT_ID
fi

generate_secret() {
  openssl rand -hex 32
}

PRESENCE_SECRET="${LOBBY_PRESENCE_SECRET:-$(generate_secret)}"
SYNC_SECRET="${LOBBY_WORKER_SYNC_SECRET:-$(generate_secret)}"

cd "$LOBBY_DIR"
npm install --no-audit --no-fund

PLACEHOLDER='00000000000000000000000000000000'
CURRENT_KV="$(grep -E '^id = ' "$WRANGLER_TOML" | head -1 | sed 's/.*"\(.*\)".*/\1/' || true)"

if [[ "$CURRENT_KV" == "$PLACEHOLDER" ]]; then
  log "creating KV namespace LOBBY_KV …"
  KV_JSON="$(npx wrangler kv namespace create LOBBY_KV 2>&1)" || true
  if echo "$KV_JSON" | grep -q ' id = '; then
    NEW_ID="$(echo "$KV_JSON" | sed -n 's/.*id = "\([^"]*\)".*/\1/p' | head -1)"
  else
    NEW_ID="$(echo "$KV_JSON" | grep -oE '[0-9a-f]{32}' | head -1)"
  fi
  if [[ -z "${NEW_ID:-}" ]]; then
    log "ERROR: could not parse KV namespace id. wrangler output:"
    echo "$KV_JSON" >&2
    exit 1
  fi
  sed -i "s/id = \"${PLACEHOLDER}\"/id = \"${NEW_ID}\"/" "$WRANGLER_TOML"
  log "wrangler.toml KV id -> ${NEW_ID}"
fi

printf '%s' "$SYNC_SECRET" | npx wrangler secret put LOBBY_WORKER_SYNC_SECRET
printf '%s' "$PRESENCE_SECRET" | npx wrangler secret put LOBBY_PRESENCE_SECRET

log "deploying worker …"
DEPLOY_OUT="$(npm run deploy 2>&1)"
echo "$DEPLOY_OUT"

WORKER_URL="$(echo "$DEPLOY_OUT" | grep -oE 'https://[a-z0-9.-]+\.workers\.dev' | tail -1 || true)"
SYNC_URL="${WORKER_URL}/api/admin/sync"

SECRETS_FILE="${LOBBY_SECRETS_OUTPUT:-${ROOT}/lobby-secrets.env}"
mkdir -p "$(dirname "$SECRETS_FILE")"
umask 077
cat >"$SECRETS_FILE" <<EOF
# metaverse-lobby — sim 本番 .env に追記（Worker と値を揃える）
LOBBY_PRESENCE_SECRET=${PRESENCE_SECRET}
LOBBY_WORKER_SYNC_SECRET=${SYNC_SECRET}
LOBBY_WORKER_SYNC_URL=${SYNC_URL}
# Worker 公開 URL（カスタムドメイン未設定時）
LOBBY_WORKER_URL=${WORKER_URL}
EOF
chmod 600 "$SECRETS_FILE"
log "wrote ${SECRETS_FILE} (sim .env 用・公開しないこと)"