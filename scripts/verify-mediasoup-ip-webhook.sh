#!/usr/bin/env bash
# mediasoup IP 同期: 変更時 webhook / unchanged 時非送信の動作確認（root）
# Usage: sudo ./verify-mediasoup-ip-webhook.sh <metasim|meta|metair|metasim-staging>
set -euo pipefail

CORE="${1:-}"
INSTALL_BIN="/usr/local/bin/metasim-mediasoup-announced-ip-sync.sh"
ENV_DIR="/etc/mmh-virtual"
FAKE_IP="${MEDIASOUP_IP_WEBHOOK_TEST_OLD_IP:-203.0.113.199}"

case "$CORE" in
  metasim) CONFIG_ENV="${ENV_DIR}/metasim-mediasoup-ip.env" ;;
  meta) CONFIG_ENV="${ENV_DIR}/meta-mediasoup-ip.env" ;;
  metair) CONFIG_ENV="${ENV_DIR}/metair-mediasoup-ip.env" ;;
  metasim-staging) CONFIG_ENV="${ENV_DIR}/metasim-staging-mediasoup-ip.env" ;;
  *)
    echo "usage: $0 <metasim|meta|metair|metasim-staging>" >&2
    exit 2
    ;;
esac

if [[ ! -f "$CONFIG_ENV" ]]; then
  echo "verify: missing ${CONFIG_ENV}" >&2
  exit 1
fi

# shellcheck disable=SC1090
set -a
source "$CONFIG_ENV"
set +a

ENV_FILE="${METASIM_ENV_FILE:-}"
SERVICE_NAME="${METASIM_SERVICE:-}"
if [[ -z "$ENV_FILE" || ! -f "$ENV_FILE" ]]; then
  echo "verify: target .env missing: ${ENV_FILE:-<unset>}" >&2
  exit 1
fi

real_ip=""
real_ip=$(grep -E '^MEDIASOUP_ANNOUNCED_IP=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '[:space:]')
if [[ -z "$real_ip" ]]; then
  echo "verify: MEDIASOUP_ANNOUNCED_IP unset in ${ENV_FILE}" >&2
  exit 1
fi

if [[ "$real_ip" == "$FAKE_IP" ]]; then
  FAKE_IP="203.0.113.198"
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

sed "s/^MEDIASOUP_ANNOUNCED_IP=.*/MEDIASOUP_ANNOUNCED_IP=${FAKE_IP}/" "$ENV_FILE" >"$tmp"
install -o "$(stat -c '%U' "$ENV_FILE")" -g "$(stat -c '%G' "$ENV_FILE")" -m "$(stat -c '%a' "$ENV_FILE")" "$tmp" "$ENV_FILE"

echo "verify: ${CORE} step1 — expect IP update + webhook"
out1="$(mktemp)"
METASIM_MEDIASOUP_IP_ENV="$CONFIG_ENV" "$INSTALL_BIN" 2>&1 | tee "$out1"
if ! grep -q 'webhook notified' "$out1"; then
  if [[ -n "${METASIM_MEDIASOUP_IP_WEBHOOK_URL:-}" ]]; then
    echo "verify: FAIL — webhook line missing after IP change" >&2
    exit 1
  fi
  echo "verify: WARN — no webhook URL configured; skipped POST"
fi

echo "verify: ${CORE} step2 — expect unchanged, no webhook"
out2="$(mktemp)"
METASIM_MEDIASOUP_IP_ENV="$CONFIG_ENV" "$INSTALL_BIN" 2>&1 | tee "$out2"
if ! grep -q 'unchanged MEDIASOUP_ANNOUNCED_IP' "$out2"; then
  echo "verify: FAIL — expected unchanged log" >&2
  exit 1
fi
if grep -q 'webhook notified' "$out2"; then
  echo "verify: FAIL — webhook must not fire on unchanged" >&2
  exit 1
fi

current=""
current=$(grep -E '^MEDIASOUP_ANNOUNCED_IP=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '[:space:]')
if [[ "$current" != "$real_ip" ]]; then
  echo "verify: FAIL — .env IP not restored to ${real_ip} (got ${current})" >&2
  exit 1
fi

echo "verify: ok ${CORE}"
