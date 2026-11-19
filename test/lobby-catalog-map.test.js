import assert from 'node:assert/strict';
import test from 'node:test';
import { entryToWorld, worldToEntry } from '../metaverse-lobby/src/catalog-map.js';

test('worldToEntry maps UI status to lobbyStatus', () => {
    const entry = worldToEntry({ id: 'w1', name: 'W', url: 'https://x/', status: 'event', cap: 10 });
    assert.equal(entry.lobbyStatus, 'event');
    assert.equal(entry.maintenance, false);
    const maint = worldToEntry({ status: 'maint', name: 'M', url: 'https://y/' });
    assert.equal(maint.maintenance, true);
});

test('entryToWorld merges live players', () => {
    const w = entryToWorld(
        { id: 'a', name: 'A', entryUrl: 'https://x/', audience: 'signed', lobbyStatus: 'open' },
        { players: 42 },
    );
    assert.equal(w.players, 42);
    assert.equal(w.audience, 'signed');
});