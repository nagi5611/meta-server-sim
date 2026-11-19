// test/tenant-socket-cors.test.js — tenant-socket が socket-cors 単一経路を使うこと
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tenantSocketPath = path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '../lib/tenant-socket.js',
);

describe('tenant-socket CORS', () => {
    it('uses buildSocketIoCorsOptions instead of permissive origin:true default', () => {
        const src = readFileSync(tenantSocketPath, 'utf8');
        assert.match(src, /buildSocketIoCorsOptions/);
        assert.doesNotMatch(src, /origin:\s*true/);
        assert.doesNotMatch(src, /function buildSocketCors\b/);
    });
});