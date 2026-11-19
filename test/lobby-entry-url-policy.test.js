import assert from 'node:assert/strict';
import test from 'node:test';
import {
    isLobbyEntryUrlAllowed,
    isLobbyEntryOriginAllowed,
    resolveLobbyEntryUrlAllowPatterns,
} from '../lib/lobby-entry-url-policy.js';

test('default allowlist accepts https://*.mmh-virtual.jp origins', () => {
    const prev = process.env.LOBBY_ENTRY_URL_ALLOWED_ORIGINS;
    delete process.env.LOBBY_ENTRY_URL_ALLOWED_ORIGINS;
    try {
        assert.equal(isLobbyEntryUrlAllowed('https://sim.mmh-virtual.jp/P-01/', process.env), true);
        assert.equal(isLobbyEntryUrlAllowed('https://m.mmh-virtual.jp/', process.env), true);
        assert.equal(isLobbyEntryUrlAllowed('https://evil.example/phish', process.env), false);
        assert.equal(isLobbyEntryUrlAllowed('http://sim.mmh-virtual.jp/', process.env), false);
    } finally {
        if (prev === undefined) delete process.env.LOBBY_ENTRY_URL_ALLOWED_ORIGINS;
        else process.env.LOBBY_ENTRY_URL_ALLOWED_ORIGINS = prev;
    }
});

test('LOBBY_ENTRY_URL_ALLOWED_ORIGINS overrides defaults', () => {
    const prev = process.env.LOBBY_ENTRY_URL_ALLOWED_ORIGINS;
    process.env.LOBBY_ENTRY_URL_ALLOWED_ORIGINS = 'https://example.com,https://*.example.com';
    try {
        assert.equal(isLobbyEntryUrlAllowed('https://example.com/a', process.env), true);
        assert.equal(isLobbyEntryUrlAllowed('https://a.example.com/w', process.env), true);
        assert.equal(isLobbyEntryUrlAllowed('https://sim.mmh-virtual.jp/P-01/', process.env), false);
        assert.deepEqual(resolveLobbyEntryUrlAllowPatterns(process.env), [
            'https://example.com',
            'https://*.example.com',
        ]);
    } finally {
        if (prev === undefined) delete process.env.LOBBY_ENTRY_URL_ALLOWED_ORIGINS;
        else process.env.LOBBY_ENTRY_URL_ALLOWED_ORIGINS = prev;
    }
});

test('isLobbyEntryOriginAllowed validates pattern protocol', () => {
    const patterns = ['https://*.mmh-virtual.jp'];
    assert.equal(isLobbyEntryOriginAllowed('https://sim.mmh-virtual.jp', patterns), true);
    assert.equal(isLobbyEntryOriginAllowed('http://sim.mmh-virtual.jp', patterns), false);
});