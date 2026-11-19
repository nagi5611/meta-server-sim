import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    normalizeRegistryMetaverse,
    resolveLobbyPollUrls,
    statusAfterPresenceSuccess,
} from '../src/lobby-registry-urls.js';

test('resolveLobbyPollUrls uses entry origin not tenant path', () => {
    const urls = resolveLobbyPollUrls({
        entryUrl: 'https://sim.mmh-virtual.jp/P-01/',
        statusUrl: 'https://sim.mmh-virtual.jp/P-01/api/lobby/status',
        presenceUrl: 'https://sim.mmh-virtual.jp/P-01/api/lobby/presence',
    });
    assert.equal(urls.statusUrl, 'https://sim.mmh-virtual.jp/api/lobby/status');
    assert.equal(urls.presenceUrl, 'https://sim.mmh-virtual.jp/api/lobby/presence');
});

test('normalizeRegistryMetaverse rewrites poll URLs on registry rows', () => {
    const row = normalizeRegistryMetaverse({
        id: 'tenant-p-01',
        entryUrl: 'https://sim.mmh-virtual.jp/P-02/',
        statusUrl: 'https://wrong.example/status',
    });
    assert.equal(row.statusUrl, 'https://sim.mmh-virtual.jp/api/lobby/status');
    assert.equal(row.presenceUrl, 'https://sim.mmh-virtual.jp/api/lobby/presence');
});

test('statusAfterPresenceSuccess clears degraded', () => {
    assert.equal(statusAfterPresenceSuccess({ status: 'degraded' }), 'online');
    assert.equal(statusAfterPresenceSuccess({ status: 'maint' }), 'maint');
    assert.equal(statusAfterPresenceSuccess({ status: 'live' }), 'live');
    assert.equal(statusAfterPresenceSuccess({}), 'online');
});