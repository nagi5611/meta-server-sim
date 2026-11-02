#!/usr/bin/env bash
# METASIM_MEDIASOUP_IP_WEBHOOK_URL を metasim 設定から他コア env にコピーする（root）
set -euo pipefail

ENV_DIR="/etc/mmh-virtual"
SOURCE="${ENV_DIR}/metasim-mediasoup-ip.env"

if [[ ! -f "$SOURCE" ]]; then
  echo "sync-webhook: missing ${SOURCE}" >&2
  exit 1
fi

webhook_line=""
webhook_line=$(grep -E '^METASIM_MEDIASOUP_IP_WEBHOOK_URL=' "$SOURCE" | head -1 || true)
if [[ -z "$webhook_line" ]]; then
  echo "sync-webhook: no METASIM_MEDIASOUP_IP_WEBHOOK_URL in ${SOURCE} (skip)"
  exit 0
fi

apply_to() {
  local target="$1"
  [[ -f "$target" ]] || return 0
  local tmp
  tmp="$(mktemp)"
  grep -v '^METASIM_MEDIASOUP_IP_WEBHOOK_URL=' "$target" >"$tmp" || true
  printf '%s\n' "$webhook_line" >>"$tmp"
  install -m 0600 "$tmp" "$target"
  rm -f "$tmp"
  echo "sync-webhook: updated $(basename "$target")"
}

for name in meta-mediasoup-ip.env metair-mediasoup-ip.env metasim-staging-mediasoup-ip.env metasim-mediasoup-ip.env; do
  apply_to "${ENV_DIR}/${name}"
done
