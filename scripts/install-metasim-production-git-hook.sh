#!/usr/bin/env bash
# 本番 clone に post-merge フックを入れ、pull 後に npm rebuild + metasim-server restart。
# ラッパー /usr/local/bin/metasim-production-git-sync.sh もインストールする。
set -euo pipefail

REPO_DIR="${METASIM_INSTALL_DIR:-/home/nagi/sim-server/meta-server-sim}"
RUN_USER="${METASIM_RUN_USER:-nagi}"
HOOK="${REPO_DIR}/.git/hooks/post-merge"
POST_PULL="${REPO_DIR}/scripts/metasim-production-post-pull.sh"
GIT_SYNC_SRC="${REPO_DIR}/scripts/metasim-production-git-sync.sh"
GIT_SYNC_BIN="/usr/local/bin/metasim-production-git-sync.sh"

if [[ ! -d "${REPO_DIR}/.git" ]]; then
  echo "install: not a git repo: ${REPO_DIR}" >&2
  exit 1
fi

for f in "$POST_PULL" "$GIT_SYNC_SRC"; do
  if [[ ! -f "$f" ]]; then
    echo "install: missing ${f} (git pull on main first?)" >&2
    exit 1
  fi
  chmod +x "$f"
done

chown -R "$(stat -c '%U:%G' "$REPO_DIR")" "${REPO_DIR}/.git/hooks" 2>/dev/null || true

cat >"$HOOK" <<EOF
#!/usr/bin/env bash
# Installed by install-metasim-production-git-hook.sh — do not edit by hand.
set -euo pipefail
ROOT="${REPO_DIR}"
branch=\$(git -C "\$ROOT" branch --show-current 2>/dev/null || true)
if [[ "\$branch" != "main" ]]; then
  exit 0
fi
export METASIM_INSTALL_DIR="${REPO_DIR}"
if [[ \$(id -u) -eq 0 ]]; then
  exec "${POST_PULL}"
fi
if sudo -n true 2>/dev/null; then
  exec sudo -n "${POST_PULL}"
fi
echo "post-merge: run as root or configure passwordless sudo for ${POST_PULL}" >&2
exit 1
EOF
chmod +x "$HOOK"
chown "$(stat -c '%U:%G' "$REPO_DIR")" "$HOOK" 2>/dev/null || true

install -m 0755 "$GIT_SYNC_SRC" "$GIT_SYNC_BIN"

SUDOERS="/etc/sudoers.d/metasim-production-post-pull"
cat >"$SUDOERS" <<EOF
# meta-server-sim post-merge: npm rebuild + systemctl restart (git pull as ${RUN_USER})
${RUN_USER} ALL=(root) NOPASSWD: ${POST_PULL}
EOF
chmod 440 "$SUDOERS"
if command -v visudo >/dev/null 2>&1; then
  visudo -cf "$SUDOERS" || { echo "install: invalid sudoers ${SUDOERS}" >&2; exit 1; }
fi

echo "install: post-merge hook -> ${HOOK}"
echo "install: git sync wrapper -> ${GIT_SYNC_BIN}"
echo "install: prefer: sudo ${GIT_SYNC_BIN}"
echo "install: or: cd ${REPO_DIR} && git pull (runs hook if sudo/root available)"
