import test from 'node:test';
import assert from 'node:assert/strict';

const mod = await import('../lib/lobby-public-url.js');

test('normalizeLobbyPublicUrl strips path and enforces origin slash', () => {
    assert.equal(mod.normalizeLobbyPublicUrl('https://m.mmh-virtual.jp/foo?x=1'), 'https://m.mmh-virtual.jp/');
    assert.equal(mod.normalizeLobbyPublicUrl('m.mmh-virtual.jp'), 'https://m.mmh-virtual.jp/');
});

test('resolveLobbyPublicUrl respects LOBBY_PUBLIC_URL', () => {
    const prev = process.env.LOBBY_PUBLIC_URL;
    const prevNode = process.env.NODE_ENV;
    try {
        process.env.LOBBY_PUBLIC_URL = 'http://localhost:8787/join';
        delete process.env.NODE_ENV;
        assert.equal(mod.resolveLobbyPublicUrl(), 'http://localhost:8787/');
    } finally {
        if (prev === undefined) delete process.env.LOBBY_PUBLIC_URL;
        else process.env.LOBBY_PUBLIC_URL = prev;
        if (prevNode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevNode;
    }
});

test('resolveLobbyPublicUrl production default', () => {
    const prevUrl = process.env.LOBBY_PUBLIC_URL;
    const prevNode = process.env.NODE_ENV;
    try {
        delete process.env.LOBBY_PUBLIC_URL;
        process.env.NODE_ENV = 'production';
        assert.equal(mod.resolveLobbyPublicUrl(), 'https://m.mmh-virtual.jp/');
    } finally {
        if (prevUrl === undefined) delete process.env.LOBBY_PUBLIC_URL;
        else process.env.LOBBY_PUBLIC_URL = prevUrl;
        if (prevNode === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevNode;
    }
});