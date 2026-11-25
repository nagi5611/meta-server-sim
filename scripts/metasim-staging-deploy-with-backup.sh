#!/usr/bin/env bash
# ステージングデプロイ（バックアップ必須）— meta-server-sim-staging のみ
set -euo pipefail

INSTALL_DIR="${METASIM_STAGING_DIR:-/home/nagi/sim-server/meta-server-sim-staging}"
BACKUP_ROOT="${METASIM_STAGING_BACKUP_ROOT:-/home/nagi/sim-server/backups}"
BACKUP_LABEL="${1:-admin-console-staging}"
UTC="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="${BACKUP_ROOT}/${BACKUP_LABEL}-${UTC}"
BRANCH="${METASIM_STAGING_BRANCH:-cursor/admin-console-design-rebuild-2f01}"
SERVICE="${METASIM_STAGING_SERVICE:-metasim-staging-server}"

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*"; }

mkdir -p "${BACKUP_DIR}"
PRE_SHA="$(git -C "${INSTALL_DIR}" rev-parse HEAD)"
echo "${PRE_SHA}" > "${BACKUP_DIR}/pre-deploy-HEAD.sha"
tar -C "${INSTALL_DIR}" -czf "${BACKUP_DIR}/rollback-dist-public.tgz" dist public 2>/dev/null || true
test -s "${BACKUP_DIR}/rollback-dist-public.tgz" || log "WARN: rollback archive empty"

log "backup ok: ${BACKUP_DIR}"

git -C "${INSTALL_DIR}" fetch origin "${BRANCH}"
git -C "${INSTALL_DIR}" checkout "${BRANCH}"
git -C "${INSTALL_DIR}" pull --ff-only origin "${BRANCH}"

npm --prefix "${INSTALL_DIR}" ci
npm --prefix "${INSTALL_DIR}" run build
node "${INSTALL_DIR}/scripts/sync-admin-console-design.mjs" || true

sudo systemctl restart "${SERVICE}"
POST_SHA="$(git -C "${INSTALL_DIR}" rev-parse HEAD)"
log "post-deploy HEAD=${POST_SHA}"
echo "BACKUP_DIR=${BACKUP_DIR}"
echo "PRE_SHA=${PRE_SHA}"
echo "POST_SHA=${POST_SHA}"