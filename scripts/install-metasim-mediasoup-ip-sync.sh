#!/usr/bin/env bash
# 本番に mediasoup 公衆 IP 同期 cron をインストール（root + sudo）。DDNS は使わない。
set -euo pipefail

REPO_DIR="${METASIM_REPO_DIR:-/home/nagi/sim-server/meta-server-sim}"
SCRIPT_SRC="${REPO_DIR}/scripts/metasim-mediasoup-announced-ip-sync.sh"
INSTALL_BIN="/usr/local/bin/metasim-mediasoup-announced-ip-sync.sh"
ENV_DIR="/etc/mmh-virtual"
ENV_FILE="${ENV_DIR}/metasim-mediasoup-ip.env"
ENV_EXAMPLE="${REPO_DIR}/scripts/metasim-mediasoup-ip.env.example"
CRON_FILE="/etc/cron.d/metasim-mediasoup-ip-sync"
LOG_FILE="/var/log/metasim-mediasoup-ip-sync.log"

if [[ ! -f "$SCRIPT_SRC" ]]; then
  echo "install: missing ${SCRIPT_SRC} (git pull meta-server-sim?)" >&2
  exit 1
fi

install -m 0755 "$SCRIPT_SRC" "$INSTALL_BIN"
mkdir -p "$ENV_DIR"
if [[ ! -f "$ENV_FILE" ]]; then
  install -m 0600 "$ENV_EXAMPLE" "$ENV_FILE"
  echo "install: created ${ENV_FILE} — adjust METASIM_ENV_FILE if needed"
fi

cat >"$CRON_FILE" <<EOF
# meta-server-sim: MEDIASOUP_ANNOUNCED_IP ← 自宅グローバル IPv4（DNS/DDNS なし）
SHELL=/bin/bash
PATH=/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root ${INSTALL_BIN} >> ${LOG_FILE} 2>&1
EOF
chmod 644 "$CRON_FILE"
touch "$LOG_FILE"
chmod 644 "$LOG_FILE"

echo "install: cron ${CRON_FILE} (every 5 minutes)"
echo "install: log ${LOG_FILE}"
echo "install: test dry-run: METASIM_MEDIASOUP_IP_DRY_RUN=1 ${INSTALL_BIN}"
