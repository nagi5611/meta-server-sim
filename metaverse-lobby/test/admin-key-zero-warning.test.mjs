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

test('zero keys warning skipped when bootstrap env key set', async () => {
    const kv = createMemoryKv();
    const mail = [];
    const env = {
        __test_mail_sink: mail,
        ADMIN_ED25519_PUBLIC_KEY: generateTestEd25519Keypair().publicKeyB64,
    };
    const r = await maybeNotifyZeroAdminKeys(env, kv, { reason: 'login_attempt', clientIp: '1.2.3.4' });
    assert.equal(r.sent, false);
    assert.equal(r.reason, 'keys_present');
});