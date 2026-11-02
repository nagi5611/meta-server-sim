import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTenantPluginManifest } from '../lib/tenant-plugin-manifest.js';
import { checkSimEngineRange } from '../lib/tenant-plugin-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sampleRoot = path.join(__dirname, '..', 'addons', 'sample-echo');
const xrRoot = path.join(__dirname, '..', 'addons', 'xr');
const arxrRoot = path.join(__dirname, '..', 'addons', 'arxr');

test('sample-echo manifest validates', () => {
    assert.ok(fs.existsSync(sampleRoot));
    const result = readTenantPluginManifest(sampleRoot);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.manifest.id, 'sample-echo');
    const eng = checkSimEngineRange('1.0.0', result.manifest);
    assert.equal(eng.ok, true);
});

test('xr manifest validates', () => {
    assert.ok(fs.existsSync(xrRoot));
    const result = readTenantPluginManifest(xrRoot);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.manifest.id, 'xr');
    assert.equal(result.manifest.scope, 'platform');
    assert.equal(result.manifest.client?.game, 'client/game.js');
    const eng = checkSimEngineRange('1.0.0', result.manifest);
    assert.equal(eng.ok, true);
});

test('arxr manifest validates', () => {
    assert.ok(fs.existsSync(arxrRoot));
    const result = readTenantPluginManifest(arxrRoot);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.manifest.id, 'arxr');
    assert.equal(result.manifest.scope, 'platform');
    assert.equal(result.manifest.main, 'server/main.js');
    const eng = checkSimEngineRange('1.0.0', result.manifest);
    assert.equal(eng.ok, true);
});

test('invalid manifest rejected', () => {
    const result = readTenantPluginManifest(__dirname);
    assert.equal(result.ok, false);
});
