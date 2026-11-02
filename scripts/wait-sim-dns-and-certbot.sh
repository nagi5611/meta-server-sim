#!/usr/bin/env bash
# sim.mmh-virtual.jp の A が TARGET_IP になるまで待ち、certbot --nginx を実行
set -euo pipefail

DOMAIN="${METASIM_DOMAIN:-sim.mmh-virtual.jp}"
TARGET_IP="${XSERVER_SIM_TARGET_IP:-183.176.227.166}"
PORT="${METASIM_PORT:-3004}"
MAX_WAIT_SEC="${SIM_DNS_WAIT_SEC:-900}"
INTERVAL="${SIM_DNS_POLL_SEC:-20}"

deadline=$(( $(date +%s) + MAX_WAIT_SEC ))
echo "wait-sim-dns: expect ${DOMAIN} A -> ${TARGET_IP} (port ${PORT} backend)"

while [[ $(date +%s) -lt $deadline ]]; do
  current=$(dig +short "$DOMAIN" A 2>/dev/null | head -1 || true)
  if [[ "$current" == "$TARGET_IP" ]]; then
    echo "wait-sim-dns: DNS OK (${current})"
    break
  fi
  echo "wait-sim-dns: current A=${current:-empty}, retry in ${INTERVAL}s"
  sleep "$INTERVAL"
done

current=$(dig +short "$DOMAIN" A 2>/dev/null | head -1 || true)
if [[ "$current" != "$TARGET_IP" ]]; then
  echo "wait-sim-dns: timeout — still ${current:-empty}" >&2
  exit 1
fi

# 外部から nginx 経由で health が取れるまで短く待つ
for _ in 1 2 3 4 5; do
  if curl -sf --max-time 8 "http://${DOMAIN}/api/health" >/dev/null 2>&1; then
    echo "wait-sim-dns: http health reachable"
    break
  fi
  sleep 5
done

sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --register-unsafely-without-email --redirect
sudo nginx -t
sudo systemctl reload nginx

curl -sf "https://${DOMAIN}/api/health"
echo
