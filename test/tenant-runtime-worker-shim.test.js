// test/tenant-runtime-worker-shim.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Worker.postMessage のテナント URL 書き換え（prefab GLB fetch 用）
 * @param {string} url
 * @returns {string}
 */
function toTenantUrl(url, tenantBase = '/P-01') {
    const raw = String(url || '');
    if (raw.startsWith(`${tenantBase}/`)) return raw;
    if (raw.startsWith('/models/')) return `${tenantBase}${raw}`;
    return raw;
}

function applyWorkerPostMessageShim(message) {
    if (message && typeof message === 'object' && typeof message.url === 'string') {
        const nextUrl = toTenantUrl(message.url);
        if (nextUrl !== message.url) {
            return { ...message, url: nextUrl };
        }
    }
    return message;
}

describe('tenant prefab worker URL shim', () => {
    it('prefixes bare /models paths with tenant base', () => {
        const out = applyWorkerPostMessageShim({
            jobId: 1,
            url: '/models/lobby.glb',
            credentials: 'include',
        });
        assert.equal(out.url, '/P-01/models/lobby.glb');
    });

    it('leaves already tenant-prefixed URLs unchanged', () => {
        const out = applyWorkerPostMessageShim({
            jobId: 2,
            url: '/P-01/models/lobby.glb',
        });
        assert.equal(out.url, '/P-01/models/lobby.glb');
    });
});
