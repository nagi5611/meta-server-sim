#!/usr/bin/env bash
# 本番 meta-server-sim: main を pull し、post-pull（npm + rebuild + restart）を実行する。
# 通常の git pull の代わりにこれを使う（root または sudo 推奨）。
set -euo pipefail

INSTALL_DIR="${METASIM_INSTALL_DIR:-/home/nagi/sim-server/meta-server-sim}"
GIT_REF="${METASIM_GIT_REF:-main}"
RUN_USER="${METASIM_RUN_USER:-nagi}"
POST_PULL="${INSTALL_DIR}/scripts/metasim-production-post-pull.sh"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$*"
}

if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  log "ERROR: not a git repo: ${INSTALL_DIR}"
  exit 1
fi

if [[ ! -x "$POST_PULL" ]]; then
  log "ERROR: missing post-pull script: ${POST_PULL}"
  exit 1
fi

log "git fetch origin ${GIT_REF}"
sudo -u "$RUN_USER" git -C "$INSTALL_DIR" fetch origin "$GIT_REF"

current="$(sudo -u "$RUN_USER" git -C "$INSTALL_DIR" branch --show-current)"
if [[ "$current" != "$GIT_REF" ]]; then
  log "checkout ${GIT_REF} (was ${current})"
  sudo -u "$RUN_USER" git -C "$INSTALL_DIR" checkout "$GIT_REF"
fi

before="$(sudo -u "$RUN_USER" git -C "$INSTALL_DIR" rev-parse HEAD)"
log "git pull --ff-only origin ${GIT_REF}"
sudo -u "$RUN_USER" git -C "$INSTALL_DIR" pull --ff-only origin "$GIT_REF"
after="$(sudo -u "$RUN_USER" git -C "$INSTALL_DIR" rev-parse HEAD)"

if [[ "$before" == "$after" ]]; then
  log "already up to date (${after})"
  exit 0
fi

log "updated ${before:0:7}..${after:0:7}"
exec "$POST_PULL"
