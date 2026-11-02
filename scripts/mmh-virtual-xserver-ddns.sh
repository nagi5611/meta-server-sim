#!/usr/bin/env bash
# mmh-virtual.jp の A レコードを自宅グローバル IPv4 に同期（Xserver ドメイン API）
# 必要: XSERVER_API_TOKEN（Bearer）
# 任意: /etc/mmh-virtual/xserver-ddns.env を読み込む
set -euo pipefail

CONFIG_ENV="${MMH_DDNS_ENV:-/etc/mmh-virtual/xserver-ddns.env}"
if [[ -f "$CONFIG_ENV" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$CONFIG_ENV"
  set +a
fi

DOMAIN="${XSERVER_DNS_DOMAIN:-mmh-virtual.jp}"
API_BASE="${XSERVER_API_BASE:-https://api.xserver.ne.jp/v1/domain}"
STATE_DIR="${MMH_DDNS_STATE_DIR:-/var/lib/mmh-virtual-ddns}"
STATE_FILE="${STATE_DIR}/current-ipv4.txt"
IPV4_URL="${MMH_DDNS_IPV4_URL:-https://ipv4.icanhazip.com}"
# nginx 本番サブドメイン（ホスト名部分のみ）
DEFAULT_HOSTS="meta,metair,sim,metapre,metadogo,metaprehub"
HOSTS_CSV="${MMH_DDNS_HOSTS:-$DEFAULT_HOSTS}"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$*"
}

if [[ -z "${XSERVER_API_TOKEN:-}" ]]; then
  log "ERROR: XSERVER_API_TOKEN unset (see ${CONFIG_ENV}.example)"
  exit 1
fi

mkdir -p "$STATE_DIR"

current_ip=""
if ! current_ip=$(curl -4 -fsS --max-time 15 "$IPV4_URL" | tr -d '[:space:]'); then
  log "ERROR: failed to detect public IPv4 via ${IPV4_URL}"
  exit 1
fi

if [[ ! "$current_ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  log "ERROR: invalid IPv4: ${current_ip}"
  exit 1
fi

if [[ -f "$STATE_FILE" ]] && [[ "$(cat "$STATE_FILE")" == "$current_ip" ]]; then
  log "unchanged ${current_ip} (skip API)"
  exit 0
fi

log "public IPv4=${current_ip} (updating Xserver DNS)"

auth=(-H "Authorization: Bearer ${XSERVER_API_TOKEN}" -H "Content-Type: application/json")
list_json=$(curl -fsS "${API_BASE}/${DOMAIN}/dns" "${auth[@]}") || {
  log "ERROR: GET DNS list failed"
  exit 1
}

export LIST_JSON="$list_json"
export HOSTS_CSV="$HOSTS_CSV"
export CURRENT_IP="$current_ip"
export API_BASE="$API_BASE"
export DOMAIN="$DOMAIN"

updates=$(python3 <<'PY'
import json, os, sys, urllib.request

list_json = os.environ["LIST_JSON"]
hosts = [h.strip() for h in os.environ["HOSTS_CSV"].split(",") if h.strip()]
current_ip = os.environ["CURRENT_IP"]
data = json.loads(list_json)
records = data.get("records") or []

by_host = {}
for r in records:
    if r.get("type") == "A":
        by_host[r.get("host", "")] = r

plan = []
for host in hosts:
    rec = by_host.get(host)
    if not rec:
        plan.append({"action": "create", "host": host, "content": current_ip})
        continue
    if rec.get("content") == current_ip:
        continue
    plan.append({
        "action": "update",
        "host": host,
        "id": rec["id"],
        "old": rec.get("content"),
        "content": current_ip,
    })

print(json.dumps(plan))
PY
)

if [[ "$updates" == "[]" ]]; then
  log "all A records already ${current_ip}"
  echo "$current_ip" >"$STATE_FILE"
  exit 0
fi

export UPDATES_PLAN="$updates"

python3 <<'PY'
import json, os, sys, urllib.error, urllib.request

plan = json.loads(os.environ["UPDATES_PLAN"])
token = os.environ["XSERVER_API_TOKEN"]
domain = os.environ["DOMAIN"]
api_base = os.environ["API_BASE"]

def api(method, url, body=None):
    data = None
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    if body is not None:
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=30) as resp:
        return resp.read().decode()

for item in plan:
    host = item["host"]
    if item["action"] == "create":
        api(
            "POST",
            f"{api_base}/{domain}/dns",
            {
                "type": "A",
                "host": host,
                "content": item["content"],
                "ttl": 3600,
                "priority": 0,
            },
        )
        print(f"created A {host} -> {item['content']}")
    else:
        api(
            "PUT",
            f"{api_base}/{domain}/dns/{item['id']}",
            {"content": item["content"]},
        )
        print(
            f"updated A {host} {item.get('old')} -> {item['content']} (id={item['id']})"
        )
PY

echo "$current_ip" >"$STATE_FILE"
log "done"
