#!/usr/bin/env bash
# 本番: Fleet systemctl ラッパー + sudoers（root で実行）
set -euo pipefail

REPO="${METASIM_INSTALL_DIR:-/home/nagi/sim-server/meta-server-sim}"
WRAPPER_SRC="${REPO}/scripts/platform-fleet-systemctl.sh"
WRAPPER_BIN="${PLATFORM_FLEET_SYSTEMCTL_INSTALL:-/usr/local/bin/platform-fleet-systemctl.sh}"
RUN_USER="${METASIM_RUN_USER:-nagi}"

if [[ ! -f "$WRAPPER_SRC" ]]; then
  echo "install: missing $WRAPPER_SRC" >&2
  exit 1
fi

install -m 0755 "$WRAPPER_SRC" "$WRAPPER_BIN"

SUDOERS="/etc/sudoers.d/platform-fleet-ops"
cat >"$SUDOERS" <<EOF
# MetaSim fleet ops — ${RUN_USER} may control whitelisted systemd units only
${RUN_USER} ALL=(root) NOPASSWD: ${WRAPPER_BIN} *
EOF
chmod 440 "$SUDOERS"
visudo -cf "$SUDOERS"

echo "install: wrapper -> ${WRAPPER_BIN}"
echo "install: sudoers -> ${SUDOERS}"
echo "Set PLATFORM_FLEET_SYSTEMCTL_WRAPPER=${WRAPPER_BIN} in metasim-server environment if not using default path in repo."
