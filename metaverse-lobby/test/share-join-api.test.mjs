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

test('POST share-join records join_events when public session exists', async () => {
    const inserted = [];
    const env = {
        LOBBY_SIM_ORIGIN: 'https://sim.test',
        LOBBY_SIM_SERVICE_TOKEN: 'tok',
        LOBBY_DB: {
            prepare() {
                return {
                    bind(...args) {
                        return {
                            async run() {
                                inserted.push(args);
                                return { meta: { changes: 1 } };
                            },
                        };
                    },
                };
            },
        },
        LOBBY_KV: {
            async get(key, type) {
                assert.equal(key, 'registry');
                assert.equal(type, 'json');
                return { metaverses: [{ id: 'world-p01', tenantId: 'P-01', name: 'Demo' }] };
            },
        },
        LOBBY_JWT_SECRET: '0123456789abcdef0123456789abcdef',
    };
    const prevFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
        if (String(url).includes('/service/lobby/share-join/P-01/join')) {
            return new Response(JSON.stringify({ ok: true, entryUrl: 'https://sim.test/P-01/', displayJoinToken: 't' }), {
                status: 200,
                headers: { 'content-type': 'application/json' },
            });
        }
        return prevFetch(url);
    };
    const { signJwt } = await import('../src/jwt.js');
    const sessionToken = await signJwt(
        { sub: 'student-7', displayName: 'Tester', role: 'member' },
        env.LOBBY_JWT_SECRET,
        3600,
    );
    try {
        const req = new Request('https://m.test/api/share-join/P-01/join', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                cookie: `lobby_session=${sessionToken}`,
            },
            body: JSON.stringify({ displayName: 'Tester' }),
        });
        const res = await handleShareJoinRequest(req, env);
        assert.equal(res?.status, 200);
        assert.equal(inserted.length, 1);
        assert.equal(inserted[0][1], 'student-7');
        assert.equal(inserted[0][3], 'world-p01');
    } finally {
        globalThis.fetch = prevFetch;
    }
});