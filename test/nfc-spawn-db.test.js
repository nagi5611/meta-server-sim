// test/nfc-spawn-db.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runTenantPluginMigrations } from '../lib/tenant-plugin-migrations.js';
import {
    createNfcSpawn,
    isValidSpawnTokenFormat,
    resolveSpawnByToken,
} from '../addons/nfc-spawn/lib/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '../addons/nfc-spawn/migrations');

describe('nfc-spawn db', () => {
    it('migrates and resolves teleport spawn by token', () => {
        const db = new Database(':memory:');
        runTenantPluginMigrations(db, migrationsDir);
        const row = createNfcSpawn(db, {
            label: 'test',
            worldId: 'lobby',
            x: 1,
            y: 2,
            z: 3,
            yaw: 90,
            enabled: 1,
            nfcTagUid: '',
            type: 'teleport',
        });
        assert.ok(isValidSpawnTokenFormat(row.spawn_token));
        const resolved = resolveSpawnByToken(db, row.spawn_token);
        assert.equal(resolved?.worldId, 'lobby');
        assert.deepEqual(resolved?.position, { x: 1, y: 2, z: 3 });
        db.close();
    });
});