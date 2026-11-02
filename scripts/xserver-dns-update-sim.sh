#!/usr/bin/env bash
# 後方互換: sim ホストのみ更新（本番は mmh-virtual-xserver-ddns.sh を推奨）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export MMH_DDNS_HOSTS="${XSERVER_DNS_HOST:-sim}"
exec "${ROOT}/scripts/mmh-virtual-xserver-ddns.sh"
