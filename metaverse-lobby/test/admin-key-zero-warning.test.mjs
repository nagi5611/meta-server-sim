import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maybeNotifyZeroAdminKeys } from '../src/admin-key-zero-warning.js';
import { generateTestEd25519Keypair } from './test-ed25519-helpers.mjs';

function createMemoryKv() {
    const store = new Map();
    return {
        async get(key) {
            return store.get(key) ?? null;
        },
        async put(key, value) {
            store.set(key, String(value));
        },
    };
}

test('zero keys warning sends once then rate limits', async () => {
    const kv = createMemoryKv();
    const mail = [];
    const env = { __test_mail_sink: mail, LOBBY_DB: undefined };
    const first = await maybeNotifyZeroAdminKeys(env, kv, { reason: 'startup' });
    assert.equal(first.sent, true);
    assert.equal(mail.length, 1);
    const second = await maybeNotifyZeroAdminKeys(env, kv, { reason: 'startup' });
    assert.equal(second.sent, false);
    assert.equal(second.reason, 'rate_limited');
});

test('zero D1 keys warning still sent when only bootstrap env key set', async () => {
    const kv = createMemoryKv();
    const mail = [];
    const env = {
        __test_mail_sink: mail,
        ADMIN_ED25519_PUBLIC_KEY: generateTestEd25519Keypair().publicKeyB64,
        LOBBY_DB: {
            prepare() {
                return {
                    async first() {
                        return { c: 0 };
                    },
                };
            },
        },
    };
    const r = await maybeNotifyZeroAdminKeys(env, kv, { reason: 'startup' });
    assert.equal(r.sent, true);
    assert.equal(mail.length, 1);
});