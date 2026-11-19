import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import worker from '../src/index.js';
import { signJwt } from '../src/jwt.js';
import { isLobbySessionBanned } from '../src/auth-api.js';
import { handleJoinByCodeRequest, normalizeJoinCode } from '../src/join-by-code-api.js';
import { resolveLobbySessionBan } from '../src/lobby-ban-guard.js';

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

test('GET /api/metaverses hides catalog when sim reports ban on stale JWT', async () => {
    const prev = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ banned: true }), { status: 200 });
    const token = await signJwt(
        { sub: 'student-9', username: 'user', displayName: 'User', role: 'member', banned: false },
        SECRET,
        3600,
    );
    const env = {
        LOBBY_JWT_SECRET: SECRET,
        LOBBY_SIM_ORIGIN: 'https://sim.test',
        LOBBY_SIM_SERVICE_TOKEN: 'tok',
        LOBBY_KV: mockKv({
            metaverses: [{ id: 'world-a', name: 'W', entryUrl: 'https://example.com/a', audience: 'all' }],
        }),
    };
    try {
        const res = await worker.fetch(
            new Request('https://lobby.test/api/metaverses', {
                headers: { cookie: `lobby_session=${encodeURIComponent(token)}` },
            }),
            env,
        );
        const data = await res.json();
        assert.equal(data.banned, true);
        assert.deepEqual(data.metaverses, []);
    } finally {
        globalThis.fetch = prev;
    }
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

test('normalizeJoinCode uppercases join codes', () => {
    assert.equal(normalizeJoinCode(' demo-01 '), 'DEMO-01');
});

test('POST /api/join-by-code rejects banned lobby session', async () => {
    const env = {
        LOBBY_JWT_SECRET: SECRET,
        LOBBY_KV: mockKv({
            metaverses: [
                {
                    id: 'world-a',
                    name: 'Visible World',
                    joinCode: 'WORLD-A',
                    entryUrl: 'https://example.com/a',
                    audience: 'all',
                },
            ],
        }),
    };
    const cookie = await bannedCookie();
    const req = new Request('https://lobby.test/api/join-by-code', {
        method: 'POST',
        headers: { cookie, 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'WORLD-A' }),
    });
    const res = await handleJoinByCodeRequest(req, env);
    assert.ok(res);
    assert.equal(res.status, 403);
    const data = await res.json();
    assert.equal(data.error, 'banned');
});

test('POST /api/join-by-code resolves code for guests', async () => {
    const env = {
        LOBBY_JWT_SECRET: SECRET,
        LOBBY_KV: mockKv({
            metaverses: [
                {
                    id: 'world-a',
                    name: 'Visible World',
                    joinCode: 'WORLD-A',
                    entryUrl: 'https://example.com/a',
                    audience: 'all',
                },
            ],
        }),
    };
    const req = new Request('https://lobby.test/api/join-by-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: 'world-a' }),
    });
    const res = await handleJoinByCodeRequest(req, env);
    assert.equal(res?.status, 200);
    const data = await res.json();
    assert.equal(data.world?.id, 'world-a');
});

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

test('lobby index keeps join code visible and provides banned modal', () => {
    const html = readFileSync(join(publicDir, 'index.html'), 'utf8');
    const locales = JSON.parse(readFileSync(join(publicDir, 'locales.json'), 'utf8'));
    assert.match(html, /id="join-code"/);
    assert.match(html, /id="banned-scrim"/);
    assert.match(html, /data-i18n="lobby\.bannedJoinMessage"/);
    assert.match(html, /href="mailto:developer@mmh-virtual\.jp"/);
    assert.match(html, /data-i18n="lobby\.bannedContact"/);
    assert.doesNotMatch(html, /id="join-code-banned"/);
    assert.equal(locales.ja['lobby.bannedJoinMessage'], 'あなたはバンされています');
    assert.equal(locales['zh-CN']['lobby.bannedJoinMessage'], '你已被封禁');
    assert.equal(locales.en['lobby.bannedJoinMessage'], 'You are banned');
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