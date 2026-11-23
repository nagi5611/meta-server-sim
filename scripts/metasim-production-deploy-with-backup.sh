#!/usr/bin/env bash
# 本番デプロイ: バックアップ作成に失敗したら pull/build/restart しない（root 実行想定）
set -euo pipefail

INSTALL_DIR="${METASIM_INSTALL_DIR:-/home/nagi/sim-server/meta-server-sim}"
BACKUP_ROOT="${METASIM_BACKUP_ROOT:-/home/nagi/sim-server/backups}"
BACKUP_LABEL="${1:-deploy}"
UTC="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_ROOT}/${BACKUP_LABEL}-${UTC}"
GIT_SYNC="${METASIM_GIT_SYNC:-/usr/local/bin/metasim-production-git-sync.sh}"
LOCK="${METASIM_DEPLOY_LOCK:-/tmp/metasim-deploy.lock}"

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*"; }

if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
  log "ERROR: missing repo ${INSTALL_DIR}"
  exit 1
fi

PRE_SHA="$(sudo -u nagi git -C "${INSTALL_DIR}" rev-parse HEAD)"
log "pre-deploy HEAD=${PRE_SHA}"

exec flock -w 600 "${LOCK}" bash -c "
set -euo pipefail
mkdir -p \"${BACKUP_DIR}\"
echo \"${PRE_SHA}\" > \"${BACKUP_DIR}/pre-deploy-HEAD.sha\"
tar -C \"${INSTALL_DIR}\" -czf \"${BACKUP_DIR}/rollback-dist-public-xr.tgz\" dist public addons/xr server.js
test -s \"${BACKUP_DIR}/rollback-dist-public-xr.tgz\"
log() { printf '[%s] %s\n' \"\$(date -Iseconds)\" \"\$*\"; }
log \"backup ok: ${BACKUP_DIR}\"
\"${GIT_SYNC}\"
POST_SHA=\"\$(sudo -u nagi git -C \"${INSTALL_DIR}\" rev-parse HEAD)\"
log \"post-deploy HEAD=\${POST_SHA}\"
echo \"BACKUP_DIR=${BACKUP_DIR}\"
echo \"PRE_SHA=${PRE_SHA}\"
echo \"POST_SHA=\${POST_SHA}\"
"