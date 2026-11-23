import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleAdminLogin } from '../src/admin-api.js';
import { verifyJwt } from '../src/jwt.js';
import { formatJstTimestamp, getRequestClientIp } from '../src/admin-super-login.js';
import { ADMIN_KEY_MESSAGE_PREFIX } from '../src/admin-ed25519-auth.js';
import { generateTestEd25519Keypair, signEd25519Message } from './test-ed25519-helpers.mjs';

const SECRET = '0123456789abcdef0123456789abcdef';

function createMemoryKv() {
    /** @type {Map<string, string>} */
    const store = new Map();
    return {
        async get(key, type) {
            const row = store.get(key);
            if (!row) return null;
            if (type === 'json') return JSON.parse(row);
            return row;
        },
        async put(key, value) {
            store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
        },
        async delete(key) {
            store.delete(key);
        },
    };
}

function createSuperAdminAuditDb() {
    /** @type {Array<Record<string, unknown>>} */
    const events = [];
    return {
        events,
        prepare(sql) {
            const q = sql.replace(/\s+/g, ' ').trim();
            const stmt = {
                async first() {
                    if (q.includes('COUNT(*)') && q.includes('admin_ed25519_keys')) {
                        return { c: 0 };
                    }
                    return null;
                },
                async all() {
                    if (q.includes('FROM admin_ed25519_keys')) {
                        return { results: [] };
                    }
                    return { results: [] };
                },
            };
            return {
                ...stmt,
                bind(...args) {
                    return {
                        ...stmt,
                        async run() {
                            if (q.includes('INSERT INTO super_admin_login_events')) {
                                const [id, client_ip, event_at_jst, event_at_utc, outcome, detail] = args;
                                events.push({ id, client_ip, event_at_jst, event_at_utc, outcome, detail });
                                return { meta: { changes: 1 } };
                            }
                            if (q.includes('INSERT INTO admin_ed25519_keys')) {
                                return { meta: { changes: 1 } };
                            }
                            if (q.includes('UPDATE admin_ed25519_keys')) {
                                return { meta: { changes: 1 } };
                            }
                            return { meta: { changes: 0 } };
                        },
                        async all() {
                            if (q.includes('FROM super_admin_login_events')) {
                                return { results: [...events] };
                            }
                            if (q.includes('FROM admin_ed25519_keys')) {
                                return { results: [] };
                            }
                            return { results: [] };
                        },
                    };
                },
            };
        },
    };
}

test('formatJstTimestamp includes +09:00', () => {
    const s = formatJstTimestamp(new Date('2026-01-15T03:00:00.000Z'));
    assert.match(s, /\+09:00$/);
});

test('super-admin login issues Ed25519 key challenge', async () => {
    const kv = createMemoryKv();
    const db = createSuperAdminAuditDb();
    const { publicKeyB64 } = generateTestEd25519Keypair();
    const env = {
        LOBBY_ADMIN_USER: 'admin',
        LOBBY_ADMIN_PASSWORD: 'static-secret',
        LOBBY_ADMIN_SESSION_SECRET: SECRET,
        ADMIN_ED25519_PUBLIC_KEY: publicKeyB64,
        LOBBY_DB: db,
    };
    const req = new Request('http://lobby.test/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.4' },
        body: JSON.stringify({ username: 'admin', password: 'static-secret' }),
    });
    const res = await handleAdminLogin(req, env, kv);
    assert.equal(res?.status, 200);
    const data = await res.json();
    assert.equal(data.keyChallengeRequired, true);
    assert.ok(data.challengeId);
    assert.ok(data.nonce);
});

test('super-admin login verifies key signature and issues session', async () => {
    const kv = createMemoryKv();
    const db = createSuperAdminAuditDb();
    const { publicKeyB64, privateKeyPem } = generateTestEd25519Keypair();
    const env = {
        LOBBY_ADMIN_USER: 'admin',
        LOBBY_ADMIN_PASSWORD: 'static-secret',
        LOBBY_ADMIN_SESSION_SECRET: SECRET,
        ADMIN_ED25519_PUBLIC_KEY: publicKeyB64,
        LOBBY_DB: db,
    };
    const loginReq = new Request('http://lobby.test/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'static-secret' }),
    });
    const loginRes = await handleAdminLogin(loginReq, env, kv);
    const loginData = await loginRes.json();
    const message = `${ADMIN_KEY_MESSAGE_PREFIX}${loginData.challengeId}:${loginData.nonce}`;
    const signature = signEd25519Message(privateKeyPem, message);
    const verifyReq = new Request('http://lobby.test/api/admin/login/verify-key', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ challengeId: loginData.challengeId, signature }),
    });
    const verifyRes = await handleAdminLogin(verifyReq, env, kv);
    assert.equal(verifyRes?.status, 200);
    const setCookie = verifyRes.headers.get('set-cookie') || '';
    const token = setCookie.match(/lobby_admin_session=([^;]+)/)?.[1];
    const session = await verifyJwt(token, SECRET);
    assert.equal(session?.superAdmin, true);
});

test('super-admin login with wrong key rejects', async () => {
    const kv = createMemoryKv();
    const db = createSuperAdminAuditDb();
    const good = generateTestEd25519Keypair();
    const wrong = generateTestEd25519Keypair();
    const env = {
        LOBBY_ADMIN_USER: 'admin',
        LOBBY_ADMIN_PASSWORD: 'static-secret',
        LOBBY_ADMIN_SESSION_SECRET: SECRET,
        ADMIN_ED25519_PUBLIC_KEY: good.publicKeyB64,
        LOBBY_DB: db,
    };
    const loginRes = await handleAdminLogin(
        new Request('http://lobby.test/api/admin/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'admin', password: 'static-secret' }),
        }),
        env,
        kv,
    );
    const loginData = await loginRes.json();
    const message = `${ADMIN_KEY_MESSAGE_PREFIX}${loginData.challengeId}:${loginData.nonce}`;
    const signature = signEd25519Message(wrong.privateKeyPem, message);
    const verifyRes = await handleAdminLogin(
        new Request('http://lobby.test/api/admin/login/verify-key', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ challengeId: loginData.challengeId, signature }),
        }),
        env,
        kv,
    );
    assert.equal(verifyRes?.status, 401);
});

test('lobby admin email OTP and resend cooldown', async () => {
    const kv = createMemoryKv();
    const mail = [];
    const express = await import('express');
    const http = await import('node:http');
    const app = express.default();
    app.use(express.default.json());
    app.post('/service/lobby/admin-login', (req, res) => {
        res.json({
            ok: true,
            user: { username: 'sensei', email: 'sensei@school.jp', lobbyRole: 'admin' },
        });
    });
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    const env = {
        LOBBY_ADMIN_PASSWORD: 'x',
        LOBBY_ADMIN_SESSION_SECRET: SECRET,
        LOBBY_SIM_ORIGIN: `http://127.0.0.1:${port}`,
        LOBBY_SIM_SERVICE_TOKEN: 'tok',
        __test_mail_sink: mail,
    };
    try {
        const loginRes = await handleAdminLogin(
            new Request('http://lobby.test/api/admin/login', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ login: 'sensei', password: 'TeacherPass9!' }),
            }),
            env,
            kv,
        );
        assert.equal(loginRes.status, 200);
        const data = await loginRes.json();
        assert.equal(data.otpRequired, true);
        assert.equal(mail.length, 1);
        const resendRes = await handleAdminLogin(
            new Request('http://lobby.test/api/admin/login/resend-otp', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ challengeId: data.challengeId }),
            }),
            env,
            kv,
        );
        assert.equal(resendRes.status, 429);
        const resendBody = await resendRes.json();
        assert.equal(resendBody.error, 'otp_resend_cooldown');
        assert.ok(resendBody.retryAfterSec > 0);
    } finally {
        server.close();
    }
});