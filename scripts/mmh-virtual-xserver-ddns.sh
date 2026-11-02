#!/usr/bin/env bash
# mmh-virtual.jp の A レコードを自宅グローバル IPv4 に同期
# 権威 DNS が Xserver レンタルサーバー (ns*.xserver.jp) の場合は Server API を使う（必須）
set -euo pipefail

CONFIG_ENV="${MMH_DDNS_ENV:-/etc/mmh-virtual/xserver-ddns.env}"
if [[ -f "$CONFIG_ENV" ]]; then
  # shellcheck disable=SC1090
  set -a
  source "$CONFIG_ENV"
  set +a
fi

DOMAIN="${XSERVER_DNS_DOMAIN:-mmh-virtual.jp}"
# server = レンタルサーバー DNS（ns*.xserver.jp）。domain = XserverドメインAPI（権威と一致しない場合あり）
API_MODE="${XSERVER_API_MODE:-server}"
SERVER_NAME="${XSERVER_SERVER_NAME:-}"
STATE_DIR="${MMH_DDNS_STATE_DIR:-/var/lib/mmh-virtual-ddns}"
STATE_FILE="${STATE_DIR}/current-ipv4.txt"
IPV4_URL="${MMH_DDNS_IPV4_URL:-https://ipv4.icanhazip.com}"
DEFAULT_HOSTS="meta,metair,sim,metapre,metadogo,metaprehub"
HOSTS_CSV="${MMH_DDNS_HOSTS:-$DEFAULT_HOSTS}"

log() {
  printf '[%s] %s\n' "$(date -Iseconds)" "$*"
}

if [[ -z "${XSERVER_API_TOKEN:-}" ]]; then
  log "ERROR: XSERVER_API_TOKEN unset (see ${CONFIG_ENV}.example)"
  exit 1
fi

if [[ "$API_MODE" == "server" && -z "$SERVER_NAME" ]]; then
  log "ERROR: set XSERVER_SERVER_NAME (e.g. xs123456.xsrv.jp) for server API mode"
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

log "public IPv4=${current_ip} mode=${API_MODE} (updating DNS)"

export XSERVER_API_TOKEN
export DOMAIN HOSTS_CSV current_ip API_MODE SERVER_NAME

python3 <<'PY'
import json, os, urllib.error, urllib.parse, urllib.request

token = os.environ["XSERVER_API_TOKEN"]
domain = os.environ["DOMAIN"]
hosts = [h.strip() for h in os.environ["HOSTS_CSV"].split(",") if h.strip()]
current_ip = os.environ["current_ip"]
mode = os.environ["API_MODE"]
server_name = os.environ.get("SERVER_NAME", "")

headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def request(method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        err = e.read().decode()
        raise SystemExit(f"HTTP {e.code} {url}: {err}")


if mode == "server":
    q = urllib.parse.urlencode({"domain": domain})
    list_url = f"https://api.xserver.ne.jp/v1/server/{server_name}/dns?{q}"
    data = request("GET", list_url)
    records = [r for r in data.get("records", []) if r.get("type") == "A" and r.get("domain") == domain]
    by_host = {r.get("host"): r for r in records}
    for host in hosts:
        rec = by_host.get(host)
        if not rec:
            request(
                "POST",
                f"https://api.xserver.ne.jp/v1/server/{server_name}/dns",
                {
                    "domain": domain,
                    "host": host,
                    "type": "A",
                    "content": current_ip,
                    "ttl": 3600,
                },
            )
            print(f"created A {host}.{domain} -> {current_ip}")
            continue
        if rec.get("content") == current_ip:
            print(f"ok A {host}.{domain} already {current_ip}")
            continue
        rid = rec["id"]
        request(
            "PUT",
            f"https://api.xserver.ne.jp/v1/server/{server_name}/dns/{rid}",
            {"content": current_ip},
        )
        print(f"updated A {host}.{domain} {rec.get('content')} -> {current_ip} (id={rid})")
else:
    api_base = "https://api.xserver.ne.jp/v1/domain"
    data = request("GET", f"{api_base}/{domain}/dns")
    by_host = {r.get("host"): r for r in data.get("records", []) if r.get("type") == "A"}
    for host in hosts:
        rec = by_host.get(host)
        if not rec:
            request(
                "POST",
                f"{api_base}/{domain}/dns",
                {
                    "type": "A",
                    "host": host,
                    "content": current_ip,
                    "ttl": 3600,
                    "priority": 0,
                },
            )
            print(f"created A {host} -> {current_ip}")
        elif rec.get("content") != current_ip:
            request(
                "PUT",
                f"{api_base}/{domain}/dns/{rec['id']}",
                {"content": current_ip},
            )
            print(f"updated A {host} {rec.get('content')} -> {current_ip}")
PY

echo "$current_ip" >"$STATE_FILE"
log "done"
