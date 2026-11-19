#!/usr/bin/env bash
# 一覧: lobby_role 未設定（NULL / 空）の教員 — 本番適用前の確認用（#48）
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
USERS_DB="${USERS_DB_PATH:-${REPO_DIR}/data/users.db}"
SQL_FILE="${REPO_DIR}/scripts/security/sqlite-list-teachers-missing-lobby-role.sql"

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "list-teachers-missing-lobby-role: sqlite3 not found" >&2
  exit 1
fi

if [[ ! -f "$USERS_DB" ]]; then
  echo "list-teachers-missing-lobby-role: DB not found: $USERS_DB" >&2
  exit 1
fi

echo "=== teachers with NULL or empty lobby_role ($USERS_DB) ==="
sqlite3 -header -column "$USERS_DB" < "$SQL_FILE"
echo ""
echo "Total:"
sqlite3 "$USERS_DB" "SELECT COUNT(*) FROM teachers WHERE lobby_role IS NULL OR trim(lobby_role) = '';"