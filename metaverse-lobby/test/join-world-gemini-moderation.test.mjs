import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleJoinWorldRequest } from '../src/join-world-api.js';

function mockKv() {
    return {
        async get(key, type) {
            if (key === 'registry') {
                return {
                    metaverses: [{ id: 'world-a', name: 'A', entryUrl: 'https://example.com/a', audience: 'all' }],
                };
            }
            return type === 'json' ? { worlds: {}, series: {} } : null;
        },
        async put() {},
    };
}

test('POST /api/join-world rejects Gemini-flagged display names', async () => {
    const prev = globalThis.fetch;
    globalThis.fetch = async (url) => {
        if (String(url).includes('generativelanguage.googleapis.com')) {
            return new Response(
                JSON.stringify({
                    candidates: [
                        {
                            content: {
                                parts: [
                                    {
                                        text: JSON.stringify({
                                            inappropriate: true,
                                            absolute_broadcast_block: false,
                                        }),
                                    },
                                ],
                            },
                        },
                    ],
                }),
                { status: 200, headers: { 'content-type': 'application/json' } },
            );
        }
        return prev(url);
    };
    try {
        const req = new Request('https://lobby.test/api/join-world', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ worldId: 'world-a', displayName: 'RejectedName' }),
        });
        const res = await handleJoinWorldRequest(req, {
            LOBBY_KV: mockKv(),
            GEMINI_TRANSLATION_API_KEY: 'test-key',
        });
        assert.equal(res?.status, 422);
        const data = await res.json();
        assert.equal(data.error, 'display_name_rejected');
    } finally {
        globalThis.fetch = prev;
    }
});