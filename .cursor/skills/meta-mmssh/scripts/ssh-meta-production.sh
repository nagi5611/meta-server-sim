#!/usr/bin/env bash
# SSH to meta.mmh-virtual.jp as cursor using META_MMH_VIRTUAL_SSH_PASSWORD (Cursor Secret).
# Usage:
#   ssh-meta-production.sh              # interactive shell
#   ssh-meta-production.sh -- cmd ...   # remote command (preferred for agents)

set -euo pipefail

readonly META_SSH_HOST="${META_MMH_VIRTUAL_SSH_HOST:-meta.mmh-virtual.jp}"
readonly META_SSH_USER="${META_MMH_VIRTUAL_SSH_USER:-cursor}"
readonly META_SSH_PASSWORD="${META_MMH_VIRTUAL_SSH_PASSWORD:-}"

if [[ -z "$META_SSH_PASSWORD" ]]; then
  echo "ssh-meta-production: META_MMH_VIRTUAL_SSH_PASSWORD is not set (register in Cursor Environment Secrets)." >&2
  exit 1
fi

if ! command -v sshpass >/dev/null 2>&1; then
  echo "ssh-meta-production: sshpass not found. Install: sudo apt-get install -y sshpass openssh-client" >&2
  exit 1
fi

if ! command -v ssh >/dev/null 2>&1; then
  echo "ssh-meta-production: ssh not found. Install openssh-client." >&2
  exit 1
fi

ssh_common=(
  -o "BatchMode=no"
  -o "StrictHostKeyChecking=accept-new"
  -o "UserKnownHostsFile=${HOME}/.ssh/known_hosts"
)

run_remote() {
  export SSHPASS="$META_SSH_PASSWORD"
  sshpass -e ssh "${ssh_common[@]}" "${META_SSH_USER}@${META_SSH_HOST}" "$@"
}

if [[ "${1:-}" == "--" ]]; then
  shift
  if [[ $# -eq 0 ]]; then
    echo "ssh-meta-production: remote command required after --" >&2
    exit 2
  fi
  run_remote "$@"
else
  run_remote
fi
