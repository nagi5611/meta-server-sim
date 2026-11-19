#!/usr/bin/env bash
# 本番 sim .env に Resend 設定を追記（root または nagi で実行）
set -euo pipefail
ENV_FILE="${METASIM_ENV_FILE:-/home/nagi/sim-server/meta-server-sim/.env}"
FROM_DEFAULT='みんなでメタ <noreply@mmh-virtual.jp>'
FROM="${RESEND_FROM_EMAIL:-$FROM_DEFAULT}"
touch "$ENV_FILE"
upsert() {
  local key="$1" val="$2"
  # Single-quoted .env lines (safe for `source .env` when values contain < > spaces)
  local escaped="${val//\'/\'\\\'\'}"
  local line="${key}='${escaped}'"
  if grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    sed -i "s|^${key}=.*|${line}|" "$ENV_FILE"
  else
    printf '%s\n' "$line" >>"$ENV_FILE"
  fi
}
upsert RESEND_FROM_EMAIL "$FROM"
if [[ -n "${RESEND_API_KEY:-}" ]]; then
  upsert RESEND_API_KEY "$RESEND_API_KEY"
fi
echo "[resend-env] updated RESEND_FROM_EMAIL in ${ENV_FILE}"
if [[ -z "${RESEND_API_KEY:-}" ]]; then
  echo "[resend-env] WARN: RESEND_API_KEY not in environment; add manually to ${ENV_FILE}"
fi