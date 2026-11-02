#!/usr/bin/env bash
# 系列コア向け mediasoup 公衆 IP 同期 cron をインストール（root）。DDNS は使わない。
# Usage: sudo install-mediasoup-announced-ip-sync.sh <metasim|metasim-staging|meta|metair>
set -euo pipefail

CORE="${1:-}"
if [[ -z "$CORE" ]]; then
  echo "usage: $0 <metasim|metasim-staging|meta|metair>" >&2
  exit 2
fi

REPO_DIR="${METASIM_REPO_DIR:-/home/nagi/sim-server/meta-server-sim}"
SCRIPT_SRC="${REPO_DIR}/scripts/metasim-mediasoup-announced-ip-sync.sh"
INSTALL_BIN="/usr/local/bin/metasim-mediasoup-announced-ip-sync.sh"
ENV_DIR="/etc/mmh-virtual"

case "$CORE" in
  metasim)
    ENV_BASENAME="metasim-mediasoup-ip"
    ;;
  metasim-staging)
    ENV_BASENAME="metasim-staging-mediasoup-ip"
    ;;
  meta)
    ENV_BASENAME="meta-mediasoup-ip"
    ;;
  metair)
    ENV_BASENAME="metair-mediasoup-ip"
    ;;
  *)
    echo "unknown core: $CORE" >&2
    exit 2
    ;;
esac

ENV_FILE="${ENV_DIR}/${ENV_BASENAME}.env"
ENV_EXAMPLE="${REPO_DIR}/scripts/${ENV_BASENAME}.env.example"
CRON_FILE="/etc/cron.d/${ENV_BASENAME}-sync"
LOG_FILE="/var/log/${ENV_BASENAME}-sync.log"

if [[ ! -f "$SCRIPT_SRC" ]]; then
  echo "install: missing ${SCRIPT_SRC} (git pull meta-server-sim?)" >&2
  exit 1
fi
if [[ ! -f "$ENV_EXAMPLE" ]]; then
  echo "install: missing ${ENV_EXAMPLE}" >&2
  exit 1
fi

install -m 0755 "$SCRIPT_SRC" "$INSTALL_BIN"
mkdir -p "$ENV_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  install -m 0600 "$ENV_EXAMPLE" "$ENV_FILE"
  echo "install: created ${ENV_FILE}"
fi

cat >"$CRON_FILE" <<EOF
# ${CORE}: MEDIASOUP_ANNOUNCED_IP ← 自宅グローバル IPv4（DNS/DDNS なし）
SHELL=/bin/bash
PATH=/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root METASIM_MEDIASOUP_IP_ENV=${ENV_FILE} ${INSTALL_BIN} >> ${LOG_FILE} 2>&1
EOF
chmod 644 "$CRON_FILE"
touch "$LOG_FILE"
chmod 644 "$LOG_FILE"

echo "install: core=${CORE} cron=${CRON_FILE} (every 5 minutes)"
echo "install: log ${LOG_FILE}"
echo "install: test: METASIM_MEDIASOUP_IP_ENV=${ENV_FILE} METASIM_MEDIASOUP_IP_DRY_RUN=1 ${INSTALL_BIN}"

if [[ -x "${REPO_DIR}/scripts/sync-mediasoup-ip-webhook-env.sh" ]]; then
  "${REPO_DIR}/scripts/sync-mediasoup-ip-webhook-env.sh" || true
fi
