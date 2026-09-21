// test/tenant-r2-sync.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { getTenantStoragePaths } from '../lib/tenant-storage-paths.js';
import {
    getLocalDirForStore,
    listLocalStoreFilenames,
    listLocalStoreRelativePaths,
} from '../lib/tenant-r2-sync.js';

test('getLocalDirForStore resolves tenant store directories', () => {
    const root = path.join(os.tmpdir(), 'tenant-r2-sync-test');
    const paths = getTenantStoragePaths(root);
    const tenant = { id: 'P-01', paths };

    assert.equal(getLocalDirForStore(tenant, 'models'), paths.MODELS_DIR);
    assert.equal(getLocalDirForStore(tenant, 'avatars'), path.join(root, 'avatars'));
    assert.equal(getLocalDirForStore(tenant, 'unknown'), null);
});

test('listLocalStoreFilenames and listLocalStoreRelativePaths', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-r2-sync-'));
    const modelsDir = path.join(root, 'models');
    fs.mkdirSync(modelsDir, { recursive: true });
    fs.writeFileSync(path.join(modelsDir, 'lobby.glb'), 'glb');
    fs.writeFileSync(path.join(modelsDir, 'readme.txt'), 'txt');

    const names = listLocalStoreFilenames(modelsDir, (n) => n.endsWith('.glb'));
    assert.deepEqual(names, ['lobby.glb']);

    const rels = listLocalStoreRelativePaths(modelsDir);
    assert.deepEqual(rels, ['lobby.glb', 'readme.txt']);
});
