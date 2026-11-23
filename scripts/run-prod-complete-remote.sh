#!/usr/bin/env bash
set -euo pipefail
/agent/repos/meta-server-sim/.cursor/skills/meta-mmssh/scripts/ssh-meta-sudo.sh \
  'sudo -u nagi bash -lc "cd /home/nagi/sim-server/meta-server-sim && MCP_ARTIFACTS_DIR=/home/nagi/sim-server/backups/mcp-artifacts WORLD_EDIT_MCP_SNAPSHOT_DIR=/home/nagi/sim-server/backups/world-edit-mcp-snapshots node scripts/mcp-world-edit-production-complete.mjs"'