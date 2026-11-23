// test/tenant-taiko-css.test.js
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cssPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '../public/css/tenant-taiko.css');

test('tenant-taiko.css has balanced braces', () => {
    const text = fs.readFileSync(cssPath, 'utf8');
    let depth = 0;
    for (const ch of text) {
        if (ch === '{') depth += 1;
        if (ch === '}') depth -= 1;
        assert.ok(depth >= 0, 'unbalanced closing brace');
    }
    assert.equal(depth, 0, 'tenant-taiko.css must not end inside an open rule');
    assert.ok(!/\n\.taiko-results-combo-stats \{\s*$/.test(text), 'incomplete combo-stats block');
});