// test/tenant-r2-chart-bgm.test.js — chart-bgm store の R2 キーとローカル同期パス
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { getTenantStoragePaths } from '../lib/tenant-storage-paths.js';
import { getLocalDirForStore } from '../lib/tenant-r2-sync.js';
import { guessContentType, isValidStore, toR2Key } from '../lib/r2/r2-keys.js';

test('chart-bgm is a valid tenant store and maps to data/chart-bgm', () => {
    assert.equal(isValidStore('chart-bgm'), true);
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'chart-bgm-tenant-'));
    const paths = getTenantStoragePaths(root);
    const tenant = { id: 'meta-server', paths };
    assert.equal(getLocalDirForStore(tenant, 'chart-bgm'), paths.CHART_BGM_DIR);
    assert.ok(paths.CHART_BGM_DIR.endsWith(`${path.sep}data${path.sep}chart-bgm`));
});

test('toR2Key encodes chart-bgm relative paths per WS-3 naming', () => {
    const song = toR2Key('meta-server', 'chart-bgm', 'demo-song.mp3');
    assert.match(song, /\/tenants\/meta-server\/chart-bgm\/demo-song\.mp3$/);
    const part = toR2Key('meta-server', 'chart-bgm', 'demo-song-p2.mp3');
    assert.match(part, /chart-bgm\/demo-song-p2\.mp3$/);
    const hit = toR2Key('meta-server', 'chart-bgm', 'demo-song/hits/p1-b3-don.mp3');
    assert.match(hit, /chart-bgm\/demo-song\/hits\/p1-b3-don\.mp3$/);
});

test('guessContentType for chart-bgm audio', () => {
    assert.equal(guessContentType('theme.mp3'), 'audio/mpeg');
    assert.equal(guessContentType('hit.wav'), 'audio/wav');
});