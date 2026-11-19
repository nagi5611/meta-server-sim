import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

test('favorited world cards render a top-left star on the thumbnail', () => {
    const app = readFileSync(join(publicDir, 'app.js'), 'utf8');
    const css = readFileSync(join(publicDir, 'lobby.css'), 'utf8');
    assert.match(app, /const favStar = fav \? '<span class="star"/);
    assert.match(app, /\$\{favStar\}/);
    assert.match(css, /\.ph \.star\{[\s\S]*left:8px;top:8px/);
    assert.match(css, /\.ph \.badge\{[\s\S]*right:8px;top:8px/);
});