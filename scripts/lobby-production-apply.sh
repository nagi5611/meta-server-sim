#!/usr/bin/env bash
# 本番 sim ホスト上で root または passwordless-sudo 可能ユーザーが実行する。
# main を pull → ロビー用 .env 追記 → カタログ初期化 → metasim-server 再起動
set -euo pipefail

INSTALL_DIR="${METASIM_INSTALL_DIR:-/home/nagi/sim-server/meta-server-sim}"
LOBBY_ENV_FILE="${LOBBY_ENV_FILE:-}"
GIT_REF="${METASIM_GIT_REF:-main}"

log() { printf '[lobby-prod] %s\n' "$*"; }

if [[ "$(id -u)" -ne 0 ]] && ! sudo -n true 2>/dev/null; then
  log "ERROR: run as root or a user with passwordless sudo (e.g. sudo bash $0)"
  exit 1
fi

run_as_nagi() {
  if [[ "$(id -u)" -eq 0 ]]; then
    sudo -u nagi "$@"
  else
    sudo -u nagi "$@"
  fi
}

if [[ -x /usr/local/bin/metasim-production-git-sync.sh ]]; then
  log "pulling ${GIT_REF} via metasim-production-git-sync.sh"
  if [[ "$(id -u)" -eq 0 ]]; then
    /usr/local/bin/metasim-production-git-sync.sh
  else
    sudo /usr/local/bin/metasim-production-git-sync.sh
  fi
else
  log "git pull in ${INSTALL_DIR}"
  run_as_nagi git -C "$INSTALL_DIR" fetch origin "$GIT_REF"
  run_as_nagi git -C "$INSTALL_DIR" checkout "$GIT_REF"
  run_as_nagi git -C "$INSTALL_DIR" pull --ff-only origin "$GIT_REF"
  if [[ -x "${INSTALL_DIR}/scripts/metasim-production-post-pull.sh" ]]; then
    if [[ "$(id -u)" -eq 0 ]]; then
      bash "${INSTALL_DIR}/scripts/metasim-production-post-pull.sh"
    else
      sudo bash "${INSTALL_DIR}/scripts/metasim-production-post-pull.sh"
    fi
  fi
fi

ENV_TARGET="${INSTALL_DIR}/.env"
if [[ -n "$LOBBY_ENV_FILE" && -f "$LOBBY_ENV_FILE" ]]; then
  log "merging lobby vars from ${LOBBY_ENV_FILE}"
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ "$line" =~ ^#.*$ || -z "${line// }" ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    if grep -q "^${key}=" "$ENV_TARGET" 2>/dev/null; then
      sed -i "s|^${key}=.*|${key}=${val}|" "$ENV_TARGET"
    else
      echo "${key}=${val}" >>"$ENV_TARGET"
    fi
  done < <(grep -E '^LOBBY_' "$LOBBY_ENV_FILE" || true)
  chown nagi:nagi "$ENV_TARGET"
fi

CATALOG="${INSTALL_DIR}/data/platform/lobby-catalog.json"
EXAMPLE="${INSTALL_DIR}/data/platform/lobby-catalog.example.json"
if [[ ! -f "$CATALOG" && -f "$EXAMPLE" ]]; then
  log "creating lobby-catalog.json from example"
  run_as_nagi cp "$EXAMPLE" "$CATALOG"
fi

if systemctl is-active --quiet metasim-server; then
  if [[ "$(id -u)" -eq 0 ]]; then
    systemctl restart metasim-server
  else
    sudo systemctl restart metasim-server
  fi
  log "metasim-server restarted"
fi

log "verify: curl -s https://sim.mmh-virtual.jp/api/lobby/status"