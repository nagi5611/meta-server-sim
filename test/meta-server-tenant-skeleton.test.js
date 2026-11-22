// test/meta-server-tenant-skeleton.test.js — WS-1 meta-server テナント骨格
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTenantFromDir } from '../lib/tenant-registry.js';
import {
    getTenantAvatarsDir,
    hasCompleteAnimationMap,
    readAvatarRegistry,
} from '../lib/tenant-avatar-registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const tenantDir = path.join(projectRoot, 'tenants', 'meta-server');

describe('meta-server tenant skeleton (WS-1)', () => {
    it('tenant.json id matches directory name', () => {
        const configPath = path.join(tenantDir, 'tenant.json');
        assert.ok(fs.existsSync(configPath), 'tenant.json must exist');
        const parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        assert.equal(parsed.id, 'meta-server');
        assert.equal(path.basename(tenantDir), parsed.id);
    });

    it('loadTenantFromDir succeeds for tenants/meta-server', () => {
        const result = loadTenantFromDir(tenantDir);
        assert.equal(result.ok, true, result.ok ? '' : result.error);
        if (result.ok) {
            assert.equal(result.record.id, 'meta-server');
            assert.equal(result.record.displayName, 'meta-server');
        }
    });

    it('worlds.json contains lobby, main, and school', () => {
        const worldsPath = path.join(tenantDir, 'data', 'worlds.json');
        const worlds = JSON.parse(fs.readFileSync(worldsPath, 'utf8'));
        for (const id of ['lobby', 'main', 'school']) {
            assert.ok(worlds[id], `missing world ${id}`);
            assert.equal(worlds[id].id, id);
        }
    });

    it('avatars registry matches sim animationMap schema', () => {
        const avatarsDir = getTenantAvatarsDir(tenantDir);
        const reg = readAvatarRegistry(avatarsDir);
        assert.ok(reg, 'avatars-registry.json must load');
        assert.equal(reg.schemaVersion, 1);
        assert.ok(Array.isArray(reg.avatars) && reg.avatars.length >= 1);
        const entry = reg.avatars.find((a) => a.isDefault) || reg.avatars[0];
        assert.equal(hasCompleteAnimationMap(entry), true);
        assert.equal(entry.glbFilename, 'avatar_v_momj3una_13923a4c0b.glb');
    });
});