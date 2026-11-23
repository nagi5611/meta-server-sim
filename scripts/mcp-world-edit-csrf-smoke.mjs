#!/usr/bin/env node
import 'dotenv/config';
import { resetWorldEditAdminClientForTests, worldEditPlaceModelForMcp } from '../lib/world-edit-mcp-ops.js';

process.env.WORLD_EDIT_MCP_BASE_URL ||= 'https://sim.mmh-virtual.jp';
process.env.WORLD_EDIT_MCP_TENANT_ID ||= 'P-01';
process.env.WORLD_EDIT_MCP_SNAPSHOT_DIR ||= '/tmp/world-edit-mcp-snapshots';

resetWorldEditAdminClientForTests();
const r = await worldEditPlaceModelForMcp('school', 'models/monument.glb', {
    position: { x: 777.1, y: 1, z: 777.1 },
    scale: { x: 0.01, y: 0.01, z: 0.01 },
    verify: true,
});
console.log(JSON.stringify(r, null, 2));