import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleAdminKeysApi } from '../src/admin-keys-api.js';

function createKeysDb() {
    /** @type {Array<Record<string, unknown>>} */
    const keys = [
        {
            id: 'active-1',
            name: 'active',
            public_key_b64: 'QQ',
            fingerprint: 'aa',
            created_at: '2026-01-01',
            last_used_at: null,
            disabled_at: null,
        },
        {
            id: 'revoked-1',
            name: 'revoked',
            public_key_b64: 'Qg',
            fingerprint: 'bb',
            created_at: '2026-01-02',
            last_used_at: null,
            disabled_at: '2026-01-03',
        },
    ];
    return {
        keys,
        prepare(sql) {
            const q = sql.replace(/\s+/g, ' ').trim();
            const stmt = {
                async all() {
                    if (q.includes('FROM admin_ed25519_keys')) {
                        const activeOnly = q.includes('disabled_at IS NULL');
                        const list = activeOnly ? keys.filter((k) => !k.disabled_at) : [...keys];
                        return {
                            results: list.map((k) => ({
                                id: k.id,
                                name: k.name,
                                public_key_b64: k.public_key_b64,
                                fingerprint: k.fingerprint,
                                created_at: k.created_at,
                                last_used_at: k.last_used_at,
                                disabled_at: k.disabled_at,
                            })),
                        };
                    }
                    return { results: [] };
                },
                async first() {
                    if (q.includes('COUNT(*)') && q.includes('admin_ed25519_keys')) {
                        const c = keys.filter((k) => !k.disabled_at).length;
                        return { c };
                    }
                    return null;
                },
            };
            return {
                ...stmt,
                bind(...args) {
                    return {
                        async first() {
                            if (q.includes('COUNT(*)') && q.includes('admin_ed25519_keys')) {
                                const c = keys.filter((k) => !k.disabled_at).length;
                                return { c };
                            }
                            return null;
                        },
                        async all() {
                            return stmt.all();
                        },
                        async run() {
                            if (q.includes('DELETE FROM admin_ed25519_keys')) {
                                const id = args[0];
                                const idx = keys.findIndex((k) => k.id === id && k.disabled_at);
                                if (idx < 0) return { meta: { changes: 0 } };
                                keys.splice(idx, 1);
                                return { meta: { changes: 1 } };
                            }
                            return { meta: { changes: 0 } };
                        },
                    };
                },
            };
        },
    };
}

const session = { sub: 'admin', superAdmin: true, role: 'admin', admin: true };
const env = { LOBBY_ADMIN_USER: 'admin', LOBBY_DB: createKeysDb() };
const kv = { get: async () => null, put: async () => {}, delete: async () => {} };

test('DELETE revoked admin key removes D1 row', async () => {
    const req = new Request('http://lobby.test/api/admin/admin-keys/revoked-1', { method: 'DELETE' });
    const res = await handleAdminKeysApi(req, env, kv, session);
    assert.equal(res?.status, 200);
    const body = await res.json();
    assert.equal(body.ok, true);
    assert.equal(body.id, 'revoked-1');
    const db = /** @type {{ keys: unknown[] }} */ (env.LOBBY_DB);
    assert.equal(db.keys.some((k) => k.id === 'revoked-1'), false);
});

test('DELETE active admin key returns 409', async () => {
    const req = new Request('http://lobby.test/api/admin/admin-keys/active-1', { method: 'DELETE' });
    const res = await handleAdminKeysApi(req, env, kv, session);
    assert.equal(res?.status, 409);
    const body = await res.json();
    assert.equal(body.error, 'key_still_active');
});

test('DELETE env-bootstrap returns key_not_deletable', async () => {
    const req = new Request('http://lobby.test/api/admin/admin-keys/env-bootstrap', { method: 'DELETE' });
    const res = await handleAdminKeysApi(req, env, kv, session);
    assert.equal(res?.status, 400);
    const body = await res.json();
    assert.equal(body.error, 'key_not_deletable');
});

test('DELETE without super admin session returns 403', async () => {
    const req = new Request('http://lobby.test/api/admin/admin-keys/revoked-1', { method: 'DELETE' });
    const res = await handleAdminKeysApi(req, env, kv, { sub: 'teacher', superAdmin: false });
    assert.equal(res?.status, 403);
});