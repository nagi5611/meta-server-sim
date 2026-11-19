import assert from 'node:assert/strict';
import { test } from 'node:test';
import { signJwt } from '../src/jwt.js';
import { handleJoinWorldRequest } from '../src/join-world-api.js';

const SECRET = '0123456789abcdef0123456789abcdef';

function mockKv() {
    return {
        async get(key, type) {
            if (key !== 'registry') return type === 'json' ? { worlds: {}, series: {} } : null;
            return {
                metaverses: [{ id: 'world-a', name: 'A', entryUrl: 'https://example.com/a', audience: 'all' }],
            };
        },
        async put() {},
    };
}

test('POST /api/join-world rejects sim ban with stale JWT', async () => {
    const prev = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ banned: true }), { status: 200 });
    const token = await signJwt({ sub: 'student-1', banned: false, role: 'member' }, SECRET, 3600);
    try {
        const req = new Request('https://lobby.test/api/join-world', {
            method: 'POST',
            headers: { cookie: `lobby_session=${encodeURIComponent(token)}`, 'content-type': 'application/json' },
            body: JSON.stringify({ worldId: 'world-a', displayName: 'P' }),
        });
        const res = await handleJoinWorldRequest(req, {
            LOBBY_JWT_SECRET: SECRET,
            LOBBY_KV: mockKv(),
            LOBBY_SIM_ORIGIN: 'https://sim.test',
            LOBBY_SIM_SERVICE_TOKEN: 'tok',
        });
        assert.equal(res?.status, 403);
    } finally {
        globalThis.fetch = prev;
    }
});