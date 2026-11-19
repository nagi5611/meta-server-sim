#!/usr/bin/env bash
# Run a remote command with sudo -S on meta.mmh-virtual.jp (cursor user).
# Password: META_MMH_VIRTUAL_SSH_SUDO_PASSWORD, else META_MMH_VIRTUAL_SSH_PASSWORD.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SUDO_PW="${META_MMH_VIRTUAL_SSH_SUDO_PASSWORD:-}"
FALLBACK_PW="${META_MMH_VIRTUAL_SSH_PASSWORD:-}"

if [[ -z "$SUDO_PW" && -z "$FALLBACK_PW" ]]; then
  echo "ssh-meta-sudo: set META_MMH_VIRTUAL_SSH_SUDO_PASSWORD or META_MMH_VIRTUAL_SSH_PASSWORD" >&2
  exit 1
fi

if [[ $# -eq 0 ]]; then
  echo "usage: ssh-meta-sudo.sh remote command …" >&2
  exit 2
fi

# Encode remote argv as one bash -lc string; sudo password via base64 on stdin (not argv).
REMOTE_CMD="$*"
B64_CMD=$(printf '%s' "$REMOTE_CMD" | base64 | tr -d '\n')
run_sudo() {
  local pw="$1"
  local B64_PW
  B64_PW=$(printf '%s' "$pw" | base64 | tr -d '\n')
  "${SCRIPT_DIR}/ssh-meta-production.sh" -- "printf '%s' '${B64_PW}' | base64 -d | sudo -S bash -lc \"\$(printf '%s' '${B64_CMD}' | base64 -d)\""
}
if [[ -n "$SUDO_PW" ]]; then
  if run_sudo "$SUDO_PW"; then
    exit 0
  fi
  [[ -n "$FALLBACK_PW" ]] || exit 1
  echo "ssh-meta-sudo: META_MMH_VIRTUAL_SSH_SUDO_PASSWORD rejected; trying SSH password" >&2
fi
run_sudo "${FALLBACK_PW:-$SUDO_PW}"