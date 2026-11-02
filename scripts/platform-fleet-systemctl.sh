#!/usr/bin/env bash
# 系列コア systemd ユニットの start/stop/restart/status（ホワイトリスト）
set -euo pipefail

ACTION="${1:-}"
UNIT="${2:-}"
REGISTRY="${PLATFORM_FLEET_REGISTRY_PATH:-/home/nagi/sim-server/meta-server-sim/data/platform/fleet-registry.json}"

if [[ -z "$ACTION" || -z "$UNIT" ]]; then
  echo "usage: $0 <status|is-active|start|stop|restart> <unit.service>" >&2
  exit 2
fi

case "$ACTION" in
  status | is-active | start | stop | restart) ;;
  *)
    echo "invalid action: $ACTION" >&2
    exit 2
    ;;
esac

if [[ ! -f "$REGISTRY" ]]; then
  echo "registry missing: $REGISTRY" >&2
  exit 1
fi

if ! python3 - "$REGISTRY" "$UNIT" <<'PY'
import json, sys
path, unit = sys.argv[1], sys.argv[2]
with open(path, encoding="utf-8") as f:
    data = json.load(f)
units = {c.get("systemdUnit") for c in data.get("cores", []) if c.get("systemdUnit")}
sys.exit(0 if unit in units else 1)
PY
then
  echo "unit not allowed: $UNIT" >&2
  exit 1
fi

if [[ "$ACTION" == "status" ]]; then
  systemctl status "$UNIT" --no-pager -l || true
  exit 0
fi

if [[ "$ACTION" == "is-active" ]]; then
  systemctl is-active "$UNIT" || true
  exit 0
fi

systemctl "$ACTION" "$UNIT"
echo "ok: systemctl $ACTION $UNIT"
