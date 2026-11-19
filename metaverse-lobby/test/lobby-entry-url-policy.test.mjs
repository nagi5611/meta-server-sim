import assert from 'node:assert/strict';
import test from 'node:test';
import { handleJoinWorldRequest } from '../src/join-world-api.js';
import { normalizeRegistryMetaverse } from '../src/lobby-registry-urls.js';
import { isLobbyEntryUrlAllowed } from '../src/lobby-entry-url-policy.js';

const MMH_WORLD = {
    id: 'world-a',
    name: 'A',
    entryUrl: 'https://sim.mmh-virtual.jp/P-01/',
    audience: 'all',
};

test('normalizeRegistryMetaverse drops disallowed entryUrl', () => {
    assert.ok(normalizeRegistryMetaverse(MMH_WORLD, {}));
    assert.equal(normalizeRegistryMetaverse({ ...MMH_WORLD, entryUrl: 'https://evil.example/x' }, {}), null);
});

test('join-world rejects disallowed entryUrl at delivery', async () => {
    const kv = {
        async get(key, type) {
            if (key !== 'registry') return null;
            if (type !== 'json') return null;
            return {
                metaverses: [{ id: 'bad', name: 'Bad', entryUrl: 'https://evil.example/x', audience: 'all' }],
            };
        },
    };
    const req = new Request('https://lobby.test/api/join-world', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId: 'bad', displayName: 'Guest' }),
    });
    const res = await handleJoinWorldRequest(req, { LOBBY_KV: kv });
    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.error, 'entry_url_not_allowed');
});

test('join-world returns mmh entryUrl when allowed', async () => {
    const kv = {
        async get(key, type) {
            if (key === 'registry' && type === 'json') return { metaverses: [MMH_WORLD] };
            if (key === 'live' && type === 'json') return { worlds: {}, series: {} };
            return null;
        },
    };
    const req = new Request('https://lobby.test/api/join-world', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ worldId: 'world-a', displayName: 'Guest' }),
    });
    const res = await handleJoinWorldRequest(req, { LOBBY_KV: kv });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.entryUrl, MMH_WORLD.entryUrl);
    assert.equal(isLobbyEntryUrlAllowed(body.entryUrl, {}), true);
});