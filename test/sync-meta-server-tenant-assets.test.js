// test/sync-meta-server-tenant-assets.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
    DEFAULT_META_SERVER_AVATAR_GLB,
    DIR_SYNC_SPECS,
    runMetaServerTenantAssetSync,
} from '../scripts/sync-meta-server-tenant-assets.mjs';

test('DIR_SYNC_SPECS excludes models and aircraft paths', () => {
    const labels = DIR_SYNC_SPECS.map((s) => s.label);
    assert.deepEqual(labels, ['env', 'images', 'pdfs', 'chart-bgm']);
    for (const spec of DIR_SYNC_SPECS) {
        assert.ok(!spec.src.includes('plane'));
        assert.ok(!spec.src.includes('aircraft'));
    }
});

test('runMetaServerTenantAssetSync copies fixture tree (dry-run via temp src)', () => {
    const srcRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-src-'));
    const destRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'meta-dest-'));

    fs.mkdirSync(path.join(srcRoot, 'env'), { recursive: true });
    fs.writeFileSync(path.join(srcRoot, 'env', 'default.hdr'), 'hdr-bytes');
    fs.mkdirSync(path.join(srcRoot, 'data', 'chart-bgm'), { recursive: true });
    fs.writeFileSync(path.join(srcRoot, 'data', 'chart-bgm', 'song.mp3'), 'mp3');
    fs.mkdirSync(path.join(srcRoot, 'avatars'), { recursive: true });
    fs.writeFileSync(
        path.join(srcRoot, 'avatars', DEFAULT_META_SERVER_AVATAR_GLB),
        'glb-bytes',
    );

    const { ok } = runMetaServerTenantAssetSync({ srcRoot, destRoot, dryRunMode: false });
    assert.equal(ok, true);
    assert.equal(fs.readFileSync(path.join(destRoot, 'env', 'default.hdr'), 'utf8'), 'hdr-bytes');
    assert.equal(fs.readFileSync(path.join(destRoot, 'data', 'chart-bgm', 'song.mp3'), 'utf8'), 'mp3');
    assert.ok(fs.existsSync(path.join(destRoot, 'avatars', DEFAULT_META_SERVER_AVATAR_GLB)));
});