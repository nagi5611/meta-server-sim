#!/usr/bin/env bash
# One-time MetaSim staging on same host as production (port 3104, isolated data).
# Run on meta.mmh-virtual.jp as root (sudo). Does NOT restart metasim-server (3004).
set -euo pipefail

PROD_DIR="${METASIM_PROD_DIR:-/home/nagi/sim-server/meta-server-sim}"
STAGING_DIR="${METASIM_STAGING_DIR:-/home/nagi/sim-server/meta-server-sim-staging}"
REPO_URL="${METASIM_REPO_URL:-https://github.com/nagi5611/meta-server-sim.git}"
REF="${METASIM_GIT_REF:-main}"
PORT="${METASIM_STAGING_PORT:-3104}"
DOMAIN="${METASIM_STAGING_DOMAIN:-staging.mmh-virtual.jp}"
SERVICE_NAME="${METASIM_STAGING_SERVICE:-metasim-staging-server}"
RUN_USER="${METASIM_RUN_USER:-nagi}"
PROD_ENV="${PROD_DIR}/.env"
STAGING_ENV="${STAGING_DIR}/.env"
SIMPLE_LINK="$(dirname "$STAGING_DIR")/metaverse-simple"
REFERENCE_META="${METASIM_METAVERSE_SIMPLE:-/home/nagi/meta-server}"
WEBAR_TEST_KEY="${METASIM_STAGING_WEBAR_API_KEY:-52f80541de1715ba47f43522d648d0800c6e514d8b5e91b9b6e13ef9e1348cb8}"
FLEET_REGISTRY="${PROD_DIR}/data/platform/fleet-registry.json"

log() { printf '[%s] %s\n' "$(date -Iseconds)" "$*"; }

env_get() {
  local key="$1" file="$2"
  grep -E "^${key}=" "$file" 2>/dev/null | head -1 | cut -d= -f2- || true
}

if [[ ! -f "$PROD_ENV" ]]; then
  log "ERROR: production env missing: $PROD_ENV"
  exit 1
fi

if [[ ! -d "$REFERENCE_META/public/js" ]]; then
  log "ERROR: metaverse-simple missing: $REFERENCE_META"
  exit 1
fi

ln -sfn "$REFERENCE_META" "$SIMPLE_LINK"
chown -h "$RUN_USER:$RUN_USER" "$SIMPLE_LINK" 2>/dev/null || true

mkdir -p "$(dirname "$STAGING_DIR")"
chown "$RUN_USER:$RUN_USER" "$(dirname "$STAGING_DIR")"

if [[ ! -d "$STAGING_DIR/.git" ]]; then
  log "git clone $REF -> $STAGING_DIR"
  sudo -u "$RUN_USER" git clone --branch "$REF" --depth 1 "$REPO_URL" "$STAGING_DIR"
else
  log "git pull $STAGING_DIR"
  sudo -u "$RUN_USER" git -C "$STAGING_DIR" fetch origin "$REF"
  sudo -u "$RUN_USER" git -C "$STAGING_DIR" checkout "$REF"
  sudo -u "$RUN_USER" git -C "$STAGING_DIR" pull --ff-only origin "$REF" || true
fi

# Isolated platform + tenant data (never copy production DB / tenants)
mkdir -p "$STAGING_DIR/data/platform"
mkdir -p "$STAGING_DIR/tenants"
if [[ ! -f "$STAGING_DIR/tenants/S-01/tenant.json" ]]; then
  log "seed tenant S-01 from _template"
  sudo -u "$RUN_USER" cp -a "$STAGING_DIR/tenants/_template" "$STAGING_DIR/tenants/S-01"
fi
sudo -u "$RUN_USER" python3 - "$STAGING_DIR/tenants/S-01/tenant.json" <<'PY'
import json, pathlib, sys
p = pathlib.Path(sys.argv[1])
if not p.is_file():
    sys.exit(0)
data = json.loads(p.read_text(encoding="utf-8"))
if data.get("id") != "S-01":
    data["id"] = "S-01"
    data["displayName"] = "Staging S-01"
    p.write_text(json.dumps(data, ensure_ascii=False, indent=4) + "\n", encoding="utf-8")
PY
chown -R "$RUN_USER:$RUN_USER" "$STAGING_DIR/data" "$STAGING_DIR/tenants"

SOCKET_SECRET="$(openssl rand -hex 32)"
ADMIN_USER="$(env_get ADMIN_USERNAME "$PROD_ENV")"
ADMIN_PASS="$(env_get ADMIN_PASSWORD "$PROD_ENV")"
ANN_IP="$(env_get MEDIASOUP_ANNOUNCED_IP "$PROD_ENV")"
ANN_LAN="$(env_get MEDIASOUP_ANNOUNCED_LAN_IP "$PROD_ENV")"
TURN_TOKEN="$(env_get CLOUDFLARE_TURN_API_TOKEN "$PROD_ENV")"
TURN_KEY="$(env_get CLOUDFLARE_TURN_KEY_ID "$PROD_ENV")"
GEMINI_KEY="$(env_get GEMINI_API_KEY "$PROD_ENV")"
GEMINI_MODEL="$(env_get GEMINI_MODEL "$PROD_ENV")"

sudo -u "$RUN_USER" tee "$STAGING_ENV" >/dev/null <<EOF
PORT=${PORT}
HOST=127.0.0.1
NODE_ENV=production

USE_REVERSE_PROXY=1
TRUST_PROXY=1
REQUIRE_SECURE_HTTP=1
PROXY_SERVICE_DOMAIN=${DOMAIN}
PROXY_DOMAIN_PORT_MAP=${DOMAIN}=${PORT}

SOCKET_CORS_ORIGINS=https://${DOMAIN}
SOCKET_AUTH_SECRET=${SOCKET_SECRET}

MEDIASOUP_ANNOUNCED_IP=${ANN_IP}
MEDIASOUP_ANNOUNCED_LAN_IP=${ANN_LAN}
VC_RTC_MIN_PORT=45200
VC_RTC_MAX_PORT=45299
VIDEO_VC_RTC_MIN_PORT=46200
VIDEO_VC_RTC_MAX_PORT=46299

ADMIN_USERNAME=${ADMIN_USER:-admin}
ADMIN_PASSWORD=${ADMIN_PASS}

CLOUDFLARE_TURN_API_TOKEN=${TURN_TOKEN}
CLOUDFLARE_TURN_KEY_ID=${TURN_KEY}
GEMINI_API_KEY=${GEMINI_KEY}
GEMINI_MODEL=${GEMINI_MODEL:-gemini-3.1-flash-lite-preview}

FDS_SMOKE_BULK_PORT=$((PORT + 10))

# Staging WebAR (test key — not production VITE_WEBAR_API_KEY)
VITE_WEBAR_API_KEY=${WEBAR_TEST_KEY}
EOF

log "npm ci + build (staging)"
sudo -u "$RUN_USER" bash -lc "cd $(printf '%q' "$STAGING_DIR") && npm ci"
sudo -u "$RUN_USER" bash -lc "cd $(printf '%q' "$STAGING_DIR") && npm rebuild"
sudo -u "$RUN_USER" bash -lc "cd $(printf '%q' "$STAGING_DIR") && env -u NODE_ENV VITE_WEBAR_API_KEY=$(printf '%q' "$WEBAR_TEST_KEY") npm run build"

tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<EOF
[Unit]
Description=meta-server-sim staging (${DOMAIN})
After=network.target

[Service]
Type=simple
User=${RUN_USER}
WorkingDirectory=${STAGING_DIR}
Environment=NODE_ENV=production
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "${SERVICE_NAME}.service"
if systemctl is-active --quiet "${SERVICE_NAME}.service"; then
  systemctl restart "${SERVICE_NAME}.service"
else
  systemctl start "${SERVICE_NAME}.service"
fi

NGINX_SNIP="/etc/nginx/sites-available/metasim-${DOMAIN}.conf"
if [[ ! -f "$NGINX_SNIP" ]]; then
  tee "$NGINX_SNIP" >/dev/null <<EOF
# meta-server-sim staging → ${DOMAIN} → 127.0.0.1:${PORT}
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
  ln -sf "$NGINX_SNIP" "/etc/nginx/sites-enabled/$(basename "$NGINX_SNIP")"
fi

nginx -t
systemctl reload nginx

if [[ ! -f "/etc/letsencrypt/live/${DOMAIN}/fullchain.pem" ]]; then
  certbot --nginx -d "${DOMAIN}" --non-interactive --agree-tos --register-unsafely-without-email --redirect || true
fi

nginx -t && systemctl reload nginx

# Fleet registry entry (production JSON file; prod metasim cache refreshes on next restart)
if [[ -f "$FLEET_REGISTRY" ]] && command -v python3 >/dev/null 2>&1; then
  python3 - "$FLEET_REGISTRY" "$SERVICE_NAME" "$STAGING_ENV" "$DOMAIN" "$PORT" <<'PY'
import json, sys
path, unit, env_file, host, port = sys.argv[1:6]
port = int(port)
with open(path, encoding="utf-8") as f:
    data = json.load(f)
cores = data.setdefault("cores", [])
entry = {
    "id": "metasim-staging",
    "label": "MetaSim staging",
    "systemdUnit": unit if unit.endswith(".service") else unit + ".service",
    "envFile": env_file,
    "publicHost": host,
    "nginxPort": port,
}
ids = {c.get("id") for c in cores}
if "metasim-staging" not in ids:
    cores.append(entry)
else:
    for c in cores:
        if c.get("id") == "metasim-staging":
            c.update(entry)
            break
with open(path, "w", encoding="utf-8") as f:
    json.dump(data, f, indent=2, ensure_ascii=False)
    f.write("\n")
print("fleet-registry: metasim-staging ok")
PY
fi

sleep 2
curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null && log "ok: staging health :${PORT}" || log "ERROR: staging health failed"
