import assert from 'node:assert/strict';
import test from 'node:test';
import {
    buildLobbyWorkerRegistry,
    upsertLobbyEntryForTenant,
} from '../lib/platform-lobby-catalog.js';

test('buildLobbyWorkerRegistry filters disabled entries', () => {
    const reg = buildLobbyWorkerRegistry({
        metaverses: [
            { id: 'a', name: 'A', entryUrl: 'https://x/', enabled: true },
            { id: 'b', name: 'B', entryUrl: 'https://y/', enabled: false },
        ],
    });
    assert.equal(reg.metaverses.length, 1);
    assert.equal(reg.metaverses[0].id, 'a');
});

test('upsertLobbyEntryForTenant creates join code from tenant id', () => {
    const saved = upsertLobbyEntryForTenant({
        tenantId: 'P-99',
        displayName: 'Test',
        entryUrl: 'https://sim.example/P-99/',
    });
    const row = saved.metaverses.find((m) => m.tenantId === 'P-99');
    assert.ok(row);
    assert.equal(row.name, 'Test');
    assert.ok(row.presenceUrl.includes('/api/lobby/presence'));
});

test('applyLobbyDisplayNameFromUrl respects displayName query', async () => {
    const g = globalThis;
    const store = new Map();
    g.localStorage = {
        getItem: (k) => store.get(k) ?? null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: (k) => store.delete(k),
    };
    g.window = {
        location: {
            search: '?displayName=LobbyUser',
            pathname: '/P-01/',
            hash: '',
        },
        history: { replaceState: () => {} },
    };
    store.clear();
    const mod = await import('../public/js/tenant-lobby-entry.js');
    mod.applyLobbyDisplayNameFromUrl();
    assert.equal(store.get('username'), 'LobbyUser');
    delete g.localStorage;
    delete g.window;
});