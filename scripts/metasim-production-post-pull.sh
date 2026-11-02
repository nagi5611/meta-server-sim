#!/usr/bin/env bash
# meta-server-sim 作業ツリー更新後: npm install/ci, rebuild, vite build, service restart。
# git pull 後（post-merge フック）または git-sync ラッパーから呼ぶ。
set -euo pipefail

INSTALL_DIR="${METASIM_INSTALL_DIR:-/home/nagi/sim-server/meta-server-sim}"
SERVICE_NAME="${METASIM_SERVICE:-metasim-server}"
RUN_USER="${METASIM_RUN_USER:-nagi}"
SYNC_BIN_SRC="${INSTALL_DIR}/scripts/metasim-mediasoup-announced-ip-sync.sh"
SYNC_BIN_DST="/usr/local/bin/metasim-mediasoup-announced-ip-sync.sh"
SKIP_BUILD="${METASIM_SKIP_BUILD:-0}"
USE_NPM_INSTALL="${METASIM_USE_NPM_INSTALL:-0}"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$*"
}

run_app() {
  sudo -u "$RUN_USER" bash -lc "cd $(printf '%q' "$INSTALL_DIR") && $*"
}

if [[ ! -d "$INSTALL_DIR" ]]; then
  log "ERROR: install dir missing: ${INSTALL_DIR}"
  exit 1
fi

if [[ ! -f "$INSTALL_DIR/package.json" ]]; then
  log "ERROR: package.json missing under ${INSTALL_DIR}"
  exit 1
fi

branch="$(sudo -u "$RUN_USER" git -C "$INSTALL_DIR" branch --show-current 2>/dev/null || true)"
if [[ -n "$branch" && "$branch" != "main" ]]; then
  log "skip: branch=${branch} (only main runs post-pull rebuild)"
  exit 0
fi

log "post-pull: dir=${INSTALL_DIR} service=${SERVICE_NAME}"

if [[ "$(echo "$USE_NPM_INSTALL" | tr '[:upper:]' '[:lower:]')" =~ ^(1|true|yes|on)$ ]]; then
  log "npm install"
  run_app npm install
else
  log "npm ci"
  run_app npm ci
fi

log "npm rebuild"
run_app npm rebuild

if [[ "$(echo "$SKIP_BUILD" | tr '[:upper:]' '[:lower:]')" =~ ^(1|true|yes|on)$ ]]; then
  log "skip vite build (METASIM_SKIP_BUILD)"
else
  log "npm run build"
  run_app "env -u NODE_ENV npm run build"
fi

if [[ -f "$SYNC_BIN_SRC" ]] && [[ "$(id -u)" -eq 0 ]]; then
  install -m 0755 "$SYNC_BIN_SRC" "$SYNC_BIN_DST"
  log "installed ${SYNC_BIN_DST}"
fi

if [[ "$(id -u)" -eq 0 ]]; then
  systemctl restart "${SERVICE_NAME}.service"
else
  if ! sudo -n systemctl restart "${SERVICE_NAME}.service" 2>/dev/null; then
    log "ERROR: need root or passwordless sudo for systemctl restart ${SERVICE_NAME}"
    exit 1
  fi
fi

sleep 2
if systemctl is-active --quiet "${SERVICE_NAME}.service"; then
  log "ok: ${SERVICE_NAME} active"
else
  log "ERROR: ${SERVICE_NAME} not active after restart"
  exit 1
fi

if command -v curl >/dev/null 2>&1; then
  port="$(grep -E '^PORT=' "$INSTALL_DIR/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '[:space:]' || echo 3004)"
  if curl -sf --max-time 5 "http://127.0.0.1:${port}/api/health" >/dev/null; then
    log "ok: /api/health on port ${port}"
  else
    log "WARN: health check failed on port ${port}"
  fi
fi
