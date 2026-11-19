#!/usr/bin/env bash
# fleet-registry.json の各 .env について mode 0600・所有者 nagi を点検し、--apply で修正する。
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_REGISTRY_PROD="/home/nagi/sim-server/meta-server-sim/data/platform/fleet-registry.json"
DEFAULT_REGISTRY_DEV="${REPO_ROOT}/data/platform/fleet-registry.json"

if [[ -n "${PLATFORM_FLEET_REGISTRY_PATH:-}" ]]; then
  REGISTRY="$PLATFORM_FLEET_REGISTRY_PATH"
elif [[ -f "$DEFAULT_REGISTRY_PROD" ]]; then
  REGISTRY="$DEFAULT_REGISTRY_PROD"
elif [[ -f "$DEFAULT_REGISTRY_DEV" ]]; then
  REGISTRY="$DEFAULT_REGISTRY_DEV"
else
  REGISTRY="$DEFAULT_REGISTRY_PROD"
fi
EXPECTED_OWNER="${ENV_FILE_EXPECTED_OWNER:-nagi}"
TARGET_MODE="600"
APPLY=0

usage() {
  echo "usage: $0 [--apply]" >&2
  echo "  default: audit only (no chmod). --apply sets chmod ${TARGET_MODE} when needed." >&2
  exit 2
}

for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    -h | --help) usage ;;
    *) echo "unknown arg: $arg" >&2; usage ;;
  esac
done

if [[ ! -f "$REGISTRY" ]]; then
  echo "ERROR: registry missing: $REGISTRY" >&2
  exit 1
fi

mapfile -t ENV_FILES < <(
  python3 - "$REGISTRY" <<'PY'
import json, sys
with open(sys.argv[1], encoding="utf-8") as f:
    data = json.load(f)
for c in data.get("cores", []):
    p = (c.get("envFile") or "").strip()
    if p:
        print(p)
PY
)

if [[ ${#ENV_FILES[@]} -eq 0 ]]; then
  echo "ERROR: no envFile entries in $REGISTRY" >&2
  exit 1
fi

issues=0
fixed=0

echo "registry: $REGISTRY"
echo "expected owner: $EXPECTED_OWNER"
echo "target mode: $TARGET_MODE"
echo "apply: $APPLY"
echo "---"

for env_path in "${ENV_FILES[@]}"; do
  if [[ ! -e "$env_path" ]]; then
    echo "MISSING: $env_path (skip)"
    continue
  fi

  mode_oct=$(stat -c '%a' "$env_path")
  owner=$(stat -c '%U' "$env_path")
  mode_warn=0
  owner_warn=0

  # group/other に読み・書き・実行のいずれか
  if python3 - "$mode_oct" <<'PY'
import sys
m = int(sys.argv[1], 8)
sys.exit(0 if (m & 0o077) == 0 else 1)
PY
  then
    :
  else
    mode_warn=1
  fi

  if [[ "$owner" != "$EXPECTED_OWNER" ]]; then
    owner_warn=1
  fi

  if [[ $mode_warn -eq 0 && $owner_warn -eq 0 ]]; then
    echo "OK: $env_path mode=${mode_oct} owner=${owner}"
    continue
  fi

  issues=$((issues + 1))
  echo "ISSUE: $env_path mode=${mode_oct} owner=${owner}"

  if [[ $owner_warn -eq 1 ]]; then
    echo "  -> chown ${EXPECTED_OWNER} (requires root; not run by this script)"
    if [[ $APPLY -eq 1 ]]; then
      echo "  !! skip chmod until owner is ${EXPECTED_OWNER}"
      continue
    fi
  fi

  if [[ $mode_warn -eq 1 && $APPLY -eq 1 ]]; then
    if chmod "$TARGET_MODE" "$env_path"; then
      new_mode=$(stat -c '%a' "$env_path")
      fixed=$((fixed + 1))
      echo "  FIXED mode: ${new_mode}"
    else
      echo "  FAILED chmod" >&2
      exit 1
    fi
  fi
done

echo "---"
echo "issues: $issues fixed: $fixed"
if [[ $issues -gt 0 && $APPLY -eq 0 ]]; then
  echo "Re-run with --apply after fixing any wrong owners (chown)."
  exit 1
fi
if [[ $issues -gt 0 && $APPLY -eq 1 ]]; then
  exit 1
fi
echo "All listed .env files satisfy mode ${TARGET_MODE} and owner ${EXPECTED_OWNER}."