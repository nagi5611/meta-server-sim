// test/world-edit-mcp-http.integration.test.js — ローカル Admin API への MCP HTTP クライアント結合
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
    resetWorldEditAdminClientForTests,
    worldEditListWorldsForMcp,
    worldEditPlaceModelForMcp,
    worldEditDeleteObjectForMcp,
} from '../lib/world-edit-mcp-ops.js';

const BASE = process.env.WORLD_EDIT_MCP_BASE_URL || 'http://127.0.0.1:3002';

function loadDevAdminPassword() {
    if (process.env.ADMIN_PASSWORD) return;
    const credPath = path.join(process.cwd(), 'data/platform/.admin-generated-password');
    if (!fs.existsSync(credPath)) return;
    const line = fs.readFileSync(credPath, 'utf8').trim();
    const colon = line.indexOf(':');
    if (colon > 0) process.env.ADMIN_PASSWORD = line.slice(colon + 1);
}

describe('world-edit-mcp-http integration', { skip: process.env.SKIP_WORLD_EDIT_MCP_INTEGRATION === '1' }, () => {
    before(async () => {
        loadDevAdminPassword();
        process.env.WORLD_EDIT_MCP_BASE_URL = BASE;
        process.env.WORLD_EDIT_MCP_TENANT_ID = 'P-01';
        resetWorldEditAdminClientForTests();
        try {
            const res = await fetch(`${BASE}/api/health`);
            if (!res.ok) throw new Error('health not ok');
        } catch {
            throw new Error(`local server not running at ${BASE} — start npm run dev`);
        }
    });

    it('lists worlds', async () => {
        const list = await worldEditListWorldsForMcp();
        assert.ok(list.count > 0);
        assert.ok(list.worldIds.includes('lobby'));
    });

    it('places and removes a test marker model', async () => {
        const worldId = 'lobby';
        const modelPath = 'models/monument.glb';
        const position = { x: 999.125, y: 0.25, z: 999.125 };
        const placed = await worldEditPlaceModelForMcp(worldId, modelPath, {
            position,
            scale: { x: 0.01, y: 0.01, z: 0.01 },
            verify: true,
        });
        assert.equal(placed.verified?.positionMatches, true);
        assert.equal(placed.verified?.pathMatches, true);
        await worldEditDeleteObjectForMcp(worldId, placed.objectIndex);
    });
});