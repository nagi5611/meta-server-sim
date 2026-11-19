import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

test('join-code field keeps maxlength 12 and limit-hit styles', () => {
    const html = readFileSync(join(publicDir, 'index.html'), 'utf8');
    const css = readFileSync(join(publicDir, 'lobby.css'), 'utf8');
    const js = readFileSync(join(publicDir, 'app.js'), 'utf8');
    assert.match(html, /id="join-code"[^>]*maxlength="12"/);
    assert.match(html, /id="codeCount">0\/12</);
    assert.match(css, /\.join-fields\.is-limit-hit/);
    assert.match(css, /@keyframes join-fields-limit-shake/);
    assert.match(js, /pulseJoinCodeLimitHit/);
    assert.match(js, /joinCodeRejectedKey/);
    assert.match(js, /addEventListener\('paste'/);
});