import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleJoinWorldRequest } from '../src/join-world-api.js';

function mockKv() {
    return {
        async get(key, type) {
            if (key === 'registry') {
                return {
                    metaverses: [{ id: 'world-a', name: 'A', entryUrl: 'https://sim.mmh-virtual.jp/P-01/', audience: 'all' }],
                };
            }
            return type === 'json' ? { worlds: {}, series: {} } : null;
        },
        async put() {},
    };
}

test('POST /api/join-world rejects display name when Jev flags high noul', async () => {
    const prev = globalThis.fetch;
    globalThis.fetch = async (url) => {
        if (String(url).includes('typesafe.ai')) {
            return new Response(JSON.stringify({ answers: { should_reject: { noul: 0.99 } } }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        return prev(url);
    };
    try {
        const req = new Request('https://lobby.test/api/join-world', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ worldId: 'world-a', displayName: 'BadNick' }),
        });
        const res = await handleJoinWorldRequest(req, {
            LOBBY_JEV_API_KEY: 'test',
            LOBBY_KV: mockKv(),
        });
        assert.equal(res?.status, 422);
        const data = await res.json();
        assert.equal(data.error, 'display_name_rejected');
    } finally {
        globalThis.fetch = prev;
    }
});