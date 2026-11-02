#!/usr/bin/env bash
# 本番サーバーに mmh-virtual Xserver DDNS cron をインストール（root + sudo）
set -euo pipefail

REPO_DIR="${MMH_DDNS_REPO_DIR:-/home/nagi/sim-server/meta-server-sim}"
SCRIPT_SRC="${REPO_DIR}/scripts/mmh-virtual-xserver-ddns.sh"
INSTALL_BIN="/usr/local/bin/mmh-virtual-xserver-ddns.sh"
ENV_DIR="/etc/mmh-virtual"
ENV_FILE="${ENV_DIR}/xserver-ddns.env"
ENV_EXAMPLE="${REPO_DIR}/scripts/xserver-ddns.env.example"
CRON_FILE="/etc/cron.d/mmh-virtual-xserver-ddns"
LOG_FILE="/var/log/mmh-virtual-xserver-ddns.log"

if [[ ! -f "$SCRIPT_SRC" ]]; then
  echo "install: missing ${SCRIPT_SRC} (git pull meta-server-sim?)" >&2
  exit 1
fi

install -m 0755 "$SCRIPT_SRC" "$INSTALL_BIN"
mkdir -p "$ENV_DIR" /var/lib/mmh-virtual-ddns
if [[ ! -f "$ENV_FILE" ]]; then
  install -m 0600 "$ENV_EXAMPLE" "$ENV_FILE"
  echo "install: created ${ENV_FILE} — set XSERVER_API_TOKEN"
fi

cat >"$CRON_FILE" <<EOF
# mmh-virtual.jp 自宅グローバル IPv4 → Xserver DNS A レコード
SHELL=/bin/bash
PATH=/usr/sbin:/usr/bin:/sbin:/bin
*/5 * * * * root ${INSTALL_BIN} >> ${LOG_FILE} 2>&1
EOF
chmod 644 "$CRON_FILE"
touch "$LOG_FILE"
chmod 644 "$LOG_FILE"

echo "install: cron ${CRON_FILE}"
echo "install: edit ${ENV_FILE} then run: ${INSTALL_BIN}"
