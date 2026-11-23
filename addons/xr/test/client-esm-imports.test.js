// addons/xr/test/client-esm-imports.test.js — addons-client 直配信で壊れる import を検出
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const clientDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'client');

test('xr client modules avoid tenant /public/js runtime imports', () => {
    const files = fs.readdirSync(clientDir).filter((f) => f.endsWith('.js'));
    const offenders = [];
    for (const file of files) {
        const text = fs.readFileSync(path.join(clientDir, file), 'utf8');
        if (/from\s+['"]\.\.\/\.\.\/\.\.\/public\/js\//.test(text)) {
            offenders.push(file);
        }
        if (/\?url['"]/.test(text)) {
            offenders.push(`${file} (?url import)`);
        }
        if (/from\s+['"]\/js\/metaverse-i18n\.js['"]/.test(text) && file !== 'sim-platform-esm.js') {
            offenders.push(`${file} (direct i18n; use sim-platform-esm.js)`);
        }
    }
    assert.deepEqual(
        offenders,
        [],
        'use /js/metaverse-i18n.js and import.meta.url for assets instead',
    );
});