// test/tenant-shared-js-routes.test.js — /js 直配信が metaverse-i18n の import グラフを満たす
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('server simpleSharedJs includes metaverse-i18n locale chunk', () => {
    const serverSrc = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
    assert.match(
        serverSrc,
        /metaverse-i18n-locales-ko-zh-tw\.js/,
        'addons-client ESM は /js/metaverse-i18n.js の相対 import を解決する',
    );
});