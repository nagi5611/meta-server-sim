import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleShareJoinRequest } from '../src/share-join-api.js';

test('GET /api/share-join/:tenantId proxies sim resolve', async () => {
    const env = {
        LOBBY_SIM_ORIGIN: 'https://sim.test',
        LOBBY_SIM_SERVICE_TOKEN: 'tok',
    };
    const prev = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
        if (String(url).includes('/service/lobby/share-join/P-01')) {
            assert.equal(init?.headers?.authorization, 'Bearer tok');
            return new Response(
                JSON.stringify({ ok: true, tenantId: 'P-01', worldName: 'Demo', maintenance: false }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        }
        return prev(url, init);
    };
    try {
        const req = new Request('https://m.test/api/share-join/P-01', { method: 'GET' });
        const res = await handleShareJoinRequest(req, env);
        assert.equal(res?.status, 200);
        const data = await res.json();
        assert.equal(data.tenantId, 'P-01');
    } finally {
        globalThis.fetch = prev;
    }
});