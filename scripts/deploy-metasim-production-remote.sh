#!/usr/bin/env bash
# 本番 meta-server (meta.mmh-virtual.jp) 上で meta-server-sim を初回セットアップする。
# cursor ユーザー + sudo -S（パスワードは stdin）で実行すること。
set -euo pipefail

REPO_URL="${METASIM_REPO_URL:-https://github.com/nagi5611/meta-server-sim.git}"
INSTALL_DIR="${METASIM_INSTALL_DIR:-/home/nagi/sim-server/meta-server-sim}"
REF="${METASIM_GIT_REF:-main}"
PORT="${METASIM_PORT:-3004}"
DOMAIN="${METASIM_DOMAIN:-sim.mmh-virtual.jp}"
REFERENCE_ENV="${METASIM_REFERENCE_ENV:-/home/nagi/diorama/meta-server/.env}"
SERVICE_NAME="${METASIM_SERVICE:-metasim-server}"

env_get() {
  local key="$1"
  grep -E "^${key}=" "$REFERENCE_ENV" 2>/dev/null | head -1 | cut -d= -f2- || true
}

if [[ ! -f "$REFERENCE_ENV" ]]; then
  echo "deploy: reference env missing: $REFERENCE_ENV" >&2
  exit 1
fi

REFERENCE_META="${METASIM_METAVERSE_SIMPLE:-/home/nagi/meta-server}"
SIMPLE_LINK="$(dirname "$INSTALL_DIR")/metaverse-simple"

if [[ ! -d "$REFERENCE_META/public/js" ]]; then
  echo "deploy: reference metaverse tree missing: $REFERENCE_META" >&2
  exit 1
fi

ln -sfn "$REFERENCE_META" "$SIMPLE_LINK"
chown -h nagi:nagi "$SIMPLE_LINK" 2>/dev/null || true

mkdir -p "$(dirname "$INSTALL_DIR")"
chown nagi:nagi "$(dirname "$INSTALL_DIR")"
if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  sudo -u nagi git clone --branch "$REF" --depth 1 "$REPO_URL" "$INSTALL_DIR"
else
  sudo -u nagi git -C "$INSTALL_DIR" fetch origin "$REF"
  sudo -u nagi git -C "$INSTALL_DIR" checkout "$REF"
  sudo -u nagi git -C "$INSTALL_DIR" pull --ff-only origin "$REF" || true
fi

MAP="$(env_get PROXY_DOMAIN_PORT_MAP)"
if [[ "$MAP" != *"${DOMAIN}=${PORT}"* ]]; then
  MAP="${MAP},${DOMAIN}=${PORT}"
fi

SOCKET_SECRET="$(openssl rand -hex 32)"
ADMIN_USER="$(env_get ADMIN_USERNAME)"
ADMIN_PASS="$(env_get ADMIN_PASSWORD)"
ANN_IP="$(env_get MEDIASOUP_ANNOUNCED_IP)"
ANN_LAN="$(env_get MEDIASOUP_ANNOUNCED_LAN_IP)"
TURN_TOKEN="$(env_get CLOUDFLARE_TURN_API_TOKEN)"
TURN_KEY="$(env_get CLOUDFLARE_TURN_KEY_ID)"
GEMINI_KEY="$(env_get GEMINI_API_KEY)"
GEMINI_MODEL="$(env_get GEMINI_MODEL)"

sudo -u nagi tee "$INSTALL_DIR/.env" >/dev/null <<EOF
PORT=${PORT}
HOST=127.0.0.1
NODE_ENV=production

USE_REVERSE_PROXY=1
TRUST_PROXY=1
REQUIRE_SECURE_HTTP=1
PROXY_SERVICE_DOMAIN=${DOMAIN}
PROXY_DOMAIN_PORT_MAP=${MAP}

SOCKET_CORS_ORIGINS=https://${DOMAIN}
SOCKET_AUTH_SECRET=${SOCKET_SECRET}

MEDIASOUP_ANNOUNCED_IP=${ANN_IP}
MEDIASOUP_ANNOUNCED_LAN_IP=${ANN_LAN}
VC_RTC_MIN_PORT=45000
VC_RTC_MAX_PORT=45100
VIDEO_VC_RTC_MIN_PORT=46000
VIDEO_VC_RTC_MAX_PORT=46100

ADMIN_USERNAME=${ADMIN_USER:-admin}
ADMIN_PASSWORD=${ADMIN_PASS}

CLOUDFLARE_TURN_API_TOKEN=${TURN_TOKEN}
CLOUDFLARE_TURN_KEY_ID=${TURN_KEY}
GEMINI_API_KEY=${GEMINI_KEY}
GEMINI_MODEL=${GEMINI_MODEL:-gemini-3.1-flash-lite-preview}

FDS_SMOKE_BULK_PORT=$((PORT + 10))
EOF

sudo -u nagi bash -lc "cd '$INSTALL_DIR' && npm ci && env -u NODE_ENV npm run build"

sudo tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<EOF
[Unit]
Description=meta-server-sim (metaverse simulation platform)
After=network.target

[Service]
Type=simple
User=nagi
WorkingDirectory=${INSTALL_DIR}
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable "${SERVICE_NAME}.service"
sudo systemctl restart "${SERVICE_NAME}.service"

NGINX_SNIP="/etc/nginx/sites-available/metasim-${DOMAIN}.conf"
if [[ ! -f "$NGINX_SNIP" ]]; then
  sudo tee "$NGINX_SNIP" >/dev/null <<EOF
# meta-server-sim → ${DOMAIN} → 127.0.0.1:${PORT}
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 500m;

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        include /etc/nginx/snippets/metaverse-proxy-headers.conf;
        proxy_pass http://127.0.0.1:${PORT};
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
    }
}
EOF
  sudo ln -sf "$NGINX_SNIP" "/etc/nginx/sites-enabled/$(basename "$NGINX_SNIP")"
fi

sudo nginx -t
sudo systemctl reload nginx

if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  sudo certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email --redirect || true
fi

if [[ -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]] && ! grep -q ssl_certificate "$NGINX_SNIP"; then
  sudo certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email --redirect || true
fi

sudo nginx -t && sudo systemctl reload nginx

sleep 2
curl -sf "http://127.0.0.1:${PORT}/api/health" | head -c 200
echo
