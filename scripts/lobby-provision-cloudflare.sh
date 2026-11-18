#!/usr/bin/env bash
# Cloudflare 上に metaverse-lobby Worker を初回または更新デプロイする。
# 必要: CLOUDFLARE_API_TOKEN（Workers Scripts Edit + Workers KV Storage Edit + Account Read）
# 任意: CLOUDFLARE_ACCOUNT_ID, LOBBY_KV_NAMESPACE_ID, LOBBY_PRESENCE_SECRET, LOBBY_WORKER_SYNC_SECRET
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOBBY_DIR="${ROOT}/metaverse-lobby"
WRANGLER_TOML="${LOBBY_DIR}/wrangler.toml"

log() { printf '[lobby-cf] %s\n' "$*"; }
die() { log "ERROR: $*"; exit 1; }

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  die "set CLOUDFLARE_API_TOKEN (Dashboard → My Profile → API Tokens)"
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

set_wrangler_kv_id() {
  local new_id="$1"
  sed -i "s/id = \"[^\"]*\"/id = \"${new_id}\"/" "$WRANGLER_TOML"
  log "wrangler.toml KV id -> ${new_id}"
}

# shellcheck disable=SC2120
cf_api() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local url="https://api.cloudflare.com/client/v4${path}"
  if [[ -n "$data" ]]; then
    curl -sfS -X "$method" "$url" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$data"
  else
    curl -sfS -X "$method" "$url" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json"
  fi
}

resolve_account_id() {
  if [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
    echo "$CLOUDFLARE_ACCOUNT_ID"
    return
  fi
  local out
  out="$(npx wrangler whoami 2>&1)" || die "wrangler whoami failed (token / Account ID?). Output:\n${out}"
  echo "$out" | sed -n 's/.*Account ID: \([^ ]*\).*/\1/p' | head -1
}

ensure_kv_namespace() {
  local account_id="$1"
  local explicit="${LOBBY_KV_NAMESPACE_ID:-}"

  if [[ "$CURRENT_KV" != "$PLACEHOLDER" && -n "$CURRENT_KV" ]]; then
    log "using KV id from wrangler.toml: ${CURRENT_KV}"
    return
  fi

  if [[ -n "$explicit" ]]; then
    set_wrangler_kv_id "$explicit"
    return
  fi

  log "looking up existing KV namespace LOBBY_KV …"
  local list_json
  if list_json="$(cf_api GET "/accounts/${account_id}/storage/kv/namespaces?per_page=100")"; then
    local existing_id
    existing_id="$(echo "$list_json" | python3 -c "
import json,sys
j=json.load(sys.stdin)
for row in j.get('result', []) or []:
    if row.get('title') == 'LOBBY_KV':
        print(row.get('id',''))
        break
" 2>/dev/null || true)"
    if [[ -n "$existing_id" ]]; then
      log "reusing existing KV namespace id ${existing_id}"
      set_wrangler_kv_id "$existing_id"
      return
    fi
  else
    log "KV list via API failed (token needs Workers KV Storage Read/Edit)"
  fi

  log "creating KV namespace LOBBY_KV via API …"
  local create_json
  if ! create_json="$(cf_api POST "/accounts/${account_id}/storage/kv/namespaces" '{"title":"LOBBY_KV"}')"; then
    die "could not create KV namespace. Confirm API token has Account → Workers KV Storage → Edit and CLOUDFLARE_ACCOUNT_ID matches your account."
  fi
  local new_id
  new_id="$(echo "$create_json" | python3 -c "import json,sys; j=json.load(sys.stdin); print((j.get('result') or {}).get('id',''))" 2>/dev/null || true)"
  if [[ -z "$new_id" ]]; then
    log "API response:"
    echo "$create_json"
    die "could not parse KV namespace id from API response"
  fi
  set_wrangler_kv_id "$new_id"
}

ACCOUNT_ID="$(resolve_account_id)"
if [[ -z "${ACCOUNT_ID:-}" ]]; then
  die "CLOUDFLARE_ACCOUNT_ID is empty and could not be resolved from wrangler whoami"
fi
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"
log "account id ${ACCOUNT_ID}"

ensure_kv_namespace "$ACCOUNT_ID"

log "deploying worker (first pass, before binding secrets) …"
DEPLOY_OUT="$(npm run deploy 2>&1)"
echo "$DEPLOY_OUT"

printf '%s' "$SYNC_SECRET" | npx wrangler secret put LOBBY_WORKER_SYNC_SECRET
printf '%s' "$PRESENCE_SECRET" | npx wrangler secret put LOBBY_PRESENCE_SECRET

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