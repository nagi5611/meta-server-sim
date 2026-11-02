#!/usr/bin/env bash
# sim data/users.db を D1 metaverse-sim へ投入（wrangler d1 execute）
set -euo pipefail

REPO_DIR="${METASIM_REPO_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
ENV_FILE="${METASIM_ENV_FILE:-${REPO_DIR}/.env}"
SQL_FILE="${REPO_DIR}/scripts/d1/metasim-users-import.sql"
USERS_DB="${REPO_DIR}/data/users.db"
WRANGLER_DIR="${REPO_DIR}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source <(grep -E '^(CLOUDFLARE_API_TOKEN|R2_ACCOUNT_ID|CLOUDFLARE_ACCOUNT_ID)=' "$ENV_FILE" | sed 's/\r$//')
  set +a
fi

export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-${R2_ACCOUNT_ID:-}}"

if [[ -z "${CLOUDFLARE_API_TOKEN:-}" ]]; then
  echo "upload-users-db-to-d1: CLOUDFLARE_API_TOKEN missing in ${ENV_FILE}" >&2
  exit 1
fi
if [[ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]]; then
  echo "upload-users-db-to-d1: CLOUDFLARE_ACCOUNT_ID or R2_ACCOUNT_ID missing" >&2
  exit 1
fi
if [[ ! -f "$SQL_FILE" ]]; then
  echo "upload-users-db-to-d1: missing ${SQL_FILE}" >&2
  exit 1
fi

if [[ ! -f "$USERS_DB" ]]; then
  echo "upload-users-db-to-d1: ${USERS_DB} not found; copy or create before upload" >&2
  exit 1
fi

echo "upload-users-db-to-d1: local ${USERS_DB} ($(sqlite3 "$USERS_DB" "SELECT COUNT(*) FROM students") students, $(sqlite3 "$USERS_DB" "SELECT COUNT(*) FROM teachers") teachers)"

cd "$WRANGLER_DIR"
npx wrangler d1 execute metaverse-sim --remote --file="$SQL_FILE"

echo "upload-users-db-to-d1: verifying remote counts..."
npx wrangler d1 execute metaverse-sim --remote --command "SELECT 'students' AS t, COUNT(*) AS c FROM students UNION ALL SELECT 'teachers', COUNT(*) FROM teachers;"
