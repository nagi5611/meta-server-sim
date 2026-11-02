#!/usr/bin/env bash
# 自宅グローバル IPv4 を直接取得し、対象コア .env の MEDIASOUP_ANNOUNCED_IP と
# 比較して違えば .env を更新して systemd サービスを再起動する（DDNS / DNS 更新は行わない）。
set -euo pipefail

CONFIG_ENV="${METASIM_MEDIASOUP_IP_ENV:-/etc/mmh-virtual/metasim-mediasoup-ip.env}"
if [[ -f "$CONFIG_ENV" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$CONFIG_ENV"
  set +a
fi

ENV_FILE="${METASIM_ENV_FILE:-/home/nagi/sim-server/meta-server-sim/.env}"
SERVICE_NAME="${METASIM_SERVICE:-metasim-server}"
IPV4_URL="${METASIM_IPV4_URL:-https://ipv4.icanhazip.com}"
DRY_RUN="${METASIM_MEDIASOUP_IP_DRY_RUN:-0}"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$*"
}

send_webhook() {
  local old_ip="$1"
  local new_ip="$2"
  local url="${METASIM_MEDIASOUP_IP_WEBHOOK_URL:-}"
  if [[ -z "$url" ]]; then
    return 0
  fi

  local host
  host="$(hostname -f 2>/dev/null || hostname)"
  local msg
  local label="${MEDIASOUP_IP_SYNC_LABEL:-${SERVICE_NAME}}"
  msg="[${label}] MEDIASOUP_ANNOUNCED_IP changed: ${old_ip:-<unset>} -> ${new_ip} on ${host}; ${SERVICE_NAME} restarted."

  local payload
  payload="$(
    OLD_IP="$old_ip" NEW_IP="$new_ip" MSG="$msg" SVC="$SERVICE_NAME" HOST="$host" python3 <<'PY'
import json, os
print(json.dumps({
    "content": os.environ["MSG"],
    "text": os.environ["MSG"],
    "old_ip": os.environ.get("OLD_IP") or "",
    "new_ip": os.environ["NEW_IP"],
    "service": os.environ["SVC"],
    "host": os.environ["HOST"],
}))
PY
  )"

  local http_code
  http_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 -X POST \
    -H 'Content-Type: application/json' \
    -d "$payload" \
    "$url" || echo 000)

  case "$http_code" in
    200 | 204) log "webhook notified (HTTP ${http_code})" ;;
    *)
      log "WARN: webhook POST failed (HTTP ${http_code})"
      return 1
      ;;
  esac
}

is_dry_run() {
  case "$(echo "$DRY_RUN" | tr '[:upper:]' '[:lower:]')" in
    1 | true | yes | on) return 0 ;;
    *) return 1 ;;
  esac
}

if [[ ! -f "$ENV_FILE" ]]; then
  log "ERROR: env file missing: ${ENV_FILE}"
  exit 1
fi

current_ip=""
if ! current_ip=$(curl -4 -fsS --max-time 15 "$IPV4_URL" | tr -d '[:space:]'); then
  log "ERROR: failed to detect public IPv4 via ${IPV4_URL}"
  exit 1
fi

if [[ ! "$current_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  log "ERROR: invalid IPv4 from ${IPV4_URL}: ${current_ip}"
  exit 1
fi

configured_ip=""
configured_ip=$(grep -E '^MEDIASOUP_ANNOUNCED_IP=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '[:space:]' || true)

if [[ "$configured_ip" == "$current_ip" ]]; then
  log "unchanged MEDIASOUP_ANNOUNCED_IP=${current_ip}"
  exit 0
fi

log "MEDIASOUP_ANNOUNCED_IP ${configured_ip:-<unset>} -> ${current_ip}"

if is_dry_run; then
  log "dry-run: skip .env update and ${SERVICE_NAME} restart"
  exit 0
fi

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if grep -q '^MEDIASOUP_ANNOUNCED_IP=' "$ENV_FILE"; then
  sed "s/^MEDIASOUP_ANNOUNCED_IP=.*/MEDIASOUP_ANNOUNCED_IP=${current_ip}/" "$ENV_FILE" >"$tmp"
else
  cat "$ENV_FILE" >"$tmp"
  printf '\nMEDIASOUP_ANNOUNCED_IP=%s\n' "$current_ip" >>"$tmp"
fi

install -o "$(stat -c '%U' "$ENV_FILE")" -g "$(stat -c '%G' "$ENV_FILE")" -m "$(stat -c '%a' "$ENV_FILE")" "$tmp" "$ENV_FILE"

if ! systemctl restart "${SERVICE_NAME}.service"; then
  log "ERROR: systemctl restart ${SERVICE_NAME}.service failed"
  exit 1
fi

send_webhook "${configured_ip:-}" "$current_ip" || true

log "updated ${ENV_FILE} and restarted ${SERVICE_NAME}.service"
