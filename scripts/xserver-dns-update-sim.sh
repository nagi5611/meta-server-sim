#!/usr/bin/env bash
# Xserver ドメイン API: sim.mmh-virtual.jp の A レコードを自宅グローバル IP に合わせる
# 必要: Cursor Environment Secret XSERVER_API_TOKEN（Bearer）
set -euo pipefail

DOMAIN="${XSERVER_DNS_DOMAIN:-mmh-virtual.jp}"
HOST="${XSERVER_DNS_HOST:-sim}"
TARGET_IP="${XSERVER_SIM_TARGET_IP:-183.176.227.166}"
API_BASE="${XSERVER_API_BASE:-https://api.xserver.ne.jp/v1/domain}"

if [[ -z "${XSERVER_API_TOKEN:-}" ]]; then
  echo "xserver-dns-update-sim: set XSERVER_API_TOKEN (Xserver API Bearer token)" >&2
  exit 1
fi

auth=(-H "Authorization: Bearer ${XSERVER_API_TOKEN}" -H "Content-Type: application/json")

list_json=$(curl -sS "${API_BASE}/${DOMAIN}/dns" "${auth[@]}")
record_id=$(python3 - <<'PY' "$list_json" "$HOST"
import json, sys
data = json.loads(sys.argv[1])
host = sys.argv[2]
for r in data.get("records", []):
    if r.get("type") == "A" and r.get("host") == host:
        print(r.get("id", ""))
        break
PY
)

if [[ -z "$record_id" ]]; then
  echo "xserver-dns-update-sim: creating A record ${HOST} -> ${TARGET_IP}"
  curl -sS -X POST "${API_BASE}/${DOMAIN}/dns" "${auth[@]}" \
    -d "{\"type\":\"A\",\"host\":\"${HOST}\",\"content\":\"${TARGET_IP}\",\"ttl\":3600,\"priority\":0}"
  echo
  exit 0
fi

echo "xserver-dns-update-sim: updating record id=${record_id} -> ${TARGET_IP}"
curl -sS -X PUT "${API_BASE}/${DOMAIN}/dns/${record_id}" "${auth[@]}" \
  -d "{\"content\":\"${TARGET_IP}\"}"
echo
