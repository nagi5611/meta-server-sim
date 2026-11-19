import assert from 'node:assert/strict';
import { test } from 'node:test';
import worker from '../src/index.js';
import { signJwt } from '../src/jwt.js';
import { isLobbySessionBanned } from '../src/auth-api.js';

const SECRET = '0123456789abcdef0123456789abcdef';

function mockKv(registry) {
    const store = new Map([
        ['registry', registry],
        ['live', { worlds: {}, series: {}, updatedAt: '2026-01-01T00:00:00.000Z' }],
    ]);
    return {
        async get(key, type) {
            const raw = store.get(key);
            if (raw === undefined) return null;
            return type === 'json' ? raw : JSON.stringify(raw);
        },
        async put() {},
    };
}

async function bannedCookie() {
    const token = await signJwt(
        {
            sub: 'student-1',
            username: 'banned.user',
            displayName: 'Banned User',
            role: 'member',
            banned: true,
        },
        SECRET,
        3600,
    );
    return `lobby_session=${encodeURIComponent(token)}`;
}

test('isLobbySessionBanned: true only when sub present and banned flag set', () => {
    assert.equal(isLobbySessionBanned(null), false);
    assert.equal(isLobbySessionBanned({ sub: 'student-1', banned: true }), true);
    assert.equal(isLobbySessionBanned({ banned: true }), false);
    assert.equal(isLobbySessionBanned({ sub: 'student-1', banned: false }), false);
});

test('GET /api/metaverses returns empty list for banned session', async () => {
    const env = {
        LOBBY_JWT_SECRET: SECRET,
        LOBBY_KV: mockKv({
            metaverses: [
                {
                    id: 'world-a',
                    name: 'Visible World',
                    entryUrl: 'https://example.com/a',
                    audience: 'all',
                },
            ],
            updatedAt: '2026-01-01T00:00:00.000Z',
        }),
    };
    const cookie = await bannedCookie();
    const req = new Request('https://lobby.test/api/metaverses', {
        headers: { cookie },
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.banned, true);
    assert.deepEqual(data.metaverses, []);
    assert.equal(data.viewer, 'banned');
});

test('GET /api/metaverses returns catalog for guest without session', async () => {
    const env = {
        LOBBY_JWT_SECRET: SECRET,
        LOBBY_KV: mockKv({
            metaverses: [
                {
                    id: 'world-a',
                    name: 'Visible World',
                    entryUrl: 'https://example.com/a',
                    audience: 'all',
                },
            ],
        }),
    };
    const req = new Request('https://lobby.test/api/metaverses');
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.notEqual(data.banned, true);
    assert.equal(data.metaverses.length, 1);
    assert.equal(data.metaverses[0].id, 'world-a');
});

test('GET /api/auth/me reports banned and omits user', async () => {
    const env = { LOBBY_JWT_SECRET: SECRET };
    const cookie = await bannedCookie();
    const req = new Request('https://lobby.test/api/auth/me', {
        headers: { cookie },
    });
    const res = await worker.fetch(req, env);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.banned, true);
    assert.equal(data.user, null);
});