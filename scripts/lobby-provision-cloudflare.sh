#!/usr/bin/env bash
# Cloudflare 上に metaverse-lobby Worker を初回または更新デプロイする。
# 必要: CLOUDFLARE_API_TOKEN（Workers Scripts Edit + Workers KV Storage Edit + Account Read）
# 任意: CLOUDFLARE_ACCOUNT_ID, LOBBY_KV_NAMESPACE_ID, LOBBY_WORKERS_DEV_SUBDOMAIN,
#       LOBBY_PRESENCE_SECRET, LOBBY_WORKER_SYNC_SECRET
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOBBY_DIR="${ROOT}/metaverse-lobby"
WRANGLER_TOML="${LOBBY_DIR}/wrangler.toml"
DEPLOY_LOG="${LOBBY_DEPLOY_LOG:-/tmp/lobby-wrangler-deploy.log}"

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
  sed -i "s/^id = \"[^\"]*\"/id = \"${new_id}\"/" "$WRANGLER_TOML"
  log "wrangler.toml KV id -> ${new_id}"
}

cf_curl() {
  local method="$1"
  local path="$2"
  local data="${3:-}"
  local url="https://api.cloudflare.com/client/v4${path}"
  if [[ -n "$data" ]]; then
    curl -sS -X "$method" "$url" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json" \
      --data "$data"
  else
    curl -sS -X "$method" "$url" \
      -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" \
      -H "Content-Type: application/json"
  fi
}

cf_api_ok() {
  local json="$1"
  python3 -c "import json,sys; j=json.load(sys.stdin); sys.exit(0 if j.get('success') else 1)" <<<"$json"
}

resolve_account_id() {
  if [[ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
    echo "$CLOUDFLARE_ACCOUNT_ID"
    return
  fi
  local out
  out="$(npx wrangler whoami 2>&1)" || die "wrangler whoami failed. Output:\n${out}"
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
  list_json="$(cf_curl GET "/accounts/${account_id}/storage/kv/namespaces?per_page=100")"
  if cf_api_ok "$list_json"; then
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
    log "KV list failed:"
    echo "$list_json"
    die "token needs Workers KV Storage Read/Edit"
  fi

  log "creating KV namespace LOBBY_KV via API …"
  local create_json
  create_json="$(cf_curl POST "/accounts/${account_id}/storage/kv/namespaces" '{"title":"LOBBY_KV"}')"
  if ! cf_api_ok "$create_json"; then
    echo "$create_json"
    die "could not create KV namespace"
  fi
  local new_id
  new_id="$(echo "$create_json" | python3 -c "import json,sys; j=json.load(sys.stdin); print((j.get('result') or {}).get('id',''))" 2>/dev/null || true)"
  [[ -n "$new_id" ]] || die "could not parse KV namespace id"
  set_wrangler_kv_id "$new_id"
}

get_workers_dev_subdomain() {
  local account_id="$1"
  local resp
  resp="$(cf_curl GET "/accounts/${account_id}/workers/subdomain")"
  if cf_api_ok "$resp"; then
    echo "$resp" | python3 -c "import json,sys; j=json.load(sys.stdin); print((j.get('result') or {}).get('subdomain',''))" 2>/dev/null || true
    return 0
  fi
  echo ""
}

ensure_workers_dev_subdomain() {
  local account_id="$1"
  local sub
  sub="$(get_workers_dev_subdomain "$account_id")"
  if [[ -n "$sub" ]]; then
    log "workers.dev account subdomain: ${sub}"
    return 0
  fi

  local pick="${LOBBY_WORKERS_DEV_SUBDOMAIN:-}"
  if [[ -z "$pick" ]]; then
    die "workers.dev サブドメイン未設定です。Dashboard → Workers & Pages → Your subdomain で1回設定するか、GitHub secret LOBBY_WORKERS_DEV_SUBDOMAIN（例: mmh-metaverse）を追加してください。"
  fi

  log "registering workers.dev subdomain \"${pick}\" …"
  local resp
  resp="$(cf_curl PUT "/accounts/${account_id}/workers/subdomain" "{\"subdomain\":\"${pick}\"}")"
  if ! cf_api_ok "$resp"; then
    echo "$resp"
    die "could not register workers.dev subdomain (名前の重複やトークン権限を確認)"
  fi
  log "workers.dev subdomain registered"
}

run_wrangler_deploy() {
  set +e
  npm run deploy 2>&1 | tee "$DEPLOY_LOG"
  local code="${PIPESTATUS[0]}"
  set -e
  if [[ "$code" -ne 0 ]]; then
    log "wrangler deploy failed (exit ${code}). Log: ${DEPLOY_LOG}"
    if grep -qiE 'subdomain|workers\.dev' "$DEPLOY_LOG" 2>/dev/null; then
      die "workers.dev サブドメインが必要です（上記ログ参照）"
    fi
    die "wrangler deploy failed — see ${DEPLOY_LOG} in job log / failure artifact"
  fi
}

ACCOUNT_ID="$(resolve_account_id)"
[[ -n "${ACCOUNT_ID:-}" ]] || die "CLOUDFLARE_ACCOUNT_ID が空です"
export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"
log "account id ${ACCOUNT_ID}"

ensure_kv_namespace "$ACCOUNT_ID"
ensure_workers_dev_subdomain "$ACCOUNT_ID"

log "deploying worker …"
run_wrangler_deploy

printf '%s' "$SYNC_SECRET" | npx wrangler secret put LOBBY_WORKER_SYNC_SECRET
printf '%s' "$PRESENCE_SECRET" | npx wrangler secret put LOBBY_PRESENCE_SECRET

WORKER_URL=""
if [[ -f "$DEPLOY_LOG" ]]; then
  WORKER_URL="$(grep -oE 'https://[a-zA-Z0-9.-]+\.workers\.dev' "$DEPLOY_LOG" | tail -1 || true)"
fi
if [[ -z "$WORKER_URL" ]]; then
  local_sub="$(get_workers_dev_subdomain "$ACCOUNT_ID")"
  if [[ -n "$local_sub" ]]; then
    WORKER_URL="https://metaverse-lobby.${local_sub}.workers.dev"
    log "derived worker URL ${WORKER_URL}"
  fi
fi

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