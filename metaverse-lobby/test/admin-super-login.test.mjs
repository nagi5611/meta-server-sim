import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleAdminLogin } from '../src/admin-api.js';
import { verifyJwt } from '../src/jwt.js';
import { formatJstTimestamp, getRequestClientIp } from '../src/admin-super-login.js';

const SECRET = '0123456789abcdef0123456789abcdef';

function createMemoryKv() {
    /** @type {Map<string, { value: string, expires?: number }>} */
    const store = new Map();
    return {
        async get(key, type) {
            const row = store.get(key);
            if (!row) return null;
            if (type === 'json') return JSON.parse(row.value);
            return row.value;
        },
        async put(key, value, opts) {
            store.set(key, { value: typeof value === 'string' ? value : JSON.stringify(value) });
            void opts;
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
            return {
                bind(...args) {
                    return {
                        async run() {
                            if (q.includes('INSERT INTO super_admin_login_events')) {
                                const [id, client_ip, event_at_jst, event_at_utc, outcome, detail] = args;
                                events.push({
                                    id,
                                    client_ip,
                                    event_at_jst,
                                    event_at_utc,
                                    outcome,
                                    detail,
                                });
                                return { meta: { changes: 1 } };
                            }
                            return { meta: { changes: 0 } };
                        },
                        async all() {
                            if (q.includes('FROM super_admin_login_events')) {
                                const limit = Number(args[0]) || 20;
                                const rows = [...events]
                                    .sort((a, b) => String(b.event_at_utc).localeCompare(String(a.event_at_utc)))
                                    .slice(0, limit)
                                    .map((r) => ({ ...r }));
                                return { results: rows };
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

test('getRequestClientIp prefers cf-connecting-ip', () => {
    const req = new Request('http://lobby.test/api/admin/login', {
        headers: { 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '10.0.0.1' },
    });
    assert.equal(getRequestClientIp(req), '203.0.113.9');
});

test('super-admin login with ADMIN_PHONE sends SMS OTP', async () => {
    const kv = createMemoryKv();
    const db = createSuperAdminAuditDb();
    const sms = [];
    const env = {
        LOBBY_ADMIN_USER: 'admin',
        LOBBY_ADMIN_PASSWORD: 'static-secret',
        LOBBY_ADMIN_SESSION_SECRET: SECRET,
        ADMIN_PHONE: '090-1234-5678',
        LOBBY_SIM_ORIGIN: 'http://127.0.0.1:9',
        LOBBY_SIM_SERVICE_TOKEN: 'unused',
        LOBBY_DB: db,
        __test_sms_sink: sms,
    };
    const req = new Request('http://lobby.test/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.4' },
        body: JSON.stringify({ username: 'admin', password: 'static-secret' }),
    });
    const res = await handleAdminLogin(req, env, kv);
    assert.equal(res?.status, 200);
    const data = await res.json();
    assert.equal(data.otpRequired, true);
    assert.equal(data.otpChannel, 'sms');
    assert.ok(data.challengeId);
    assert.equal(sms.length, 1);
    assert.equal(sms[0].phone, '+819012345678');
    const code = sms[0].message.match(/\d{6}/)?.[0];
    assert.ok(code);

    const verifyReq = new Request('http://lobby.test/api/admin/login/verify-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.4' },
        body: JSON.stringify({ challengeId: data.challengeId, code }),
    });
    const verifyRes = await handleAdminLogin(verifyReq, env, kv);
    assert.equal(verifyRes?.status, 200);
});

test('super-admin login with invalid ADMIN_PHONE returns admin_phone_invalid', async () => {
    const kv = createMemoryKv();
    const db = createSuperAdminAuditDb();
    const env = {
        LOBBY_ADMIN_USER: 'admin',
        LOBBY_ADMIN_PASSWORD: 'static-secret',
        LOBBY_ADMIN_SESSION_SECRET: SECRET,
        ADMIN_PHONE: '+81107037920331',
        AWS_ACCESS_KEY_ID: 'AKIATEST',
        AWS_SECRET_ACCESS_KEY: 'secret',
        LOBBY_DB: db,
    };
    const req = new Request('http://lobby.test/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'static-secret' }),
    });
    const res = await handleAdminLogin(req, env, kv);
    assert.equal(res?.status, 503);
    const data = await res.json();
    assert.equal(data.error, 'admin_phone_invalid');
});

test('super-admin login with ADMIN_EMAIL requires OTP (email fallback)', async () => {
    const kv = createMemoryKv();
    const db = createSuperAdminAuditDb();
    const mail = [];
    const env = {
        LOBBY_ADMIN_USER: 'admin',
        LOBBY_ADMIN_PASSWORD: 'static-secret',
        LOBBY_ADMIN_SESSION_SECRET: SECRET,
        ADMIN_EMAIL: 'ops@example.com',
        LOBBY_SIM_ORIGIN: 'http://127.0.0.1:9',
        LOBBY_SIM_SERVICE_TOKEN: 'unused',
        LOBBY_DB: db,
        __test_mail_sink: mail,
    };
    const req = new Request('http://lobby.test/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.4' },
        body: JSON.stringify({ username: 'admin', password: 'static-secret' }),
    });
    const res = await handleAdminLogin(req, env, kv);
    assert.equal(res?.status, 200);
    const data = await res.json();
    assert.equal(data.otpRequired, true);
    assert.ok(data.challengeId);
    assert.equal(data.clientIp, '198.51.100.4');
    assert.equal(mail.length, 1);
    assert.equal(mail[0].to, 'ops@example.com');
    const code = mail[0].text.match(/\d{6}/)?.[0];
    assert.ok(code);
    assert.ok(db.events.some((e) => e.outcome === 'password_ok'));

    const verifyReq = new Request('http://lobby.test/api/admin/login/verify-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '198.51.100.4' },
        body: JSON.stringify({ challengeId: data.challengeId, code }),
    });
    const verifyRes = await handleAdminLogin(verifyReq, env, kv);
    assert.equal(verifyRes?.status, 200);
    const setCookie = verifyRes.headers.get('set-cookie') || '';
    const token = setCookie.match(/lobby_admin_session=([^;]+)/)?.[1];
    assert.ok(token);
    const session = await verifyJwt(token, SECRET);
    assert.equal(session?.superAdmin, true);
    assert.ok(db.events.some((e) => e.outcome === 'session_ok'));
});

test('super-admin wrong password logs password_failed', async () => {
    const kv = createMemoryKv();
    const db = createSuperAdminAuditDb();
    const env = {
        LOBBY_ADMIN_USER: 'admin',
        LOBBY_ADMIN_PASSWORD: 'static-secret',
        LOBBY_ADMIN_SESSION_SECRET: SECRET,
        ADMIN_EMAIL: 'ops@example.com',
        LOBBY_DB: db,
    };
    const req = new Request('http://lobby.test/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.1' },
        body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    const res = await handleAdminLogin(req, env, kv);
    assert.equal(res?.status, 401);
    assert.equal(db.events.length, 1);
    assert.equal(db.events[0].outcome, 'password_failed');
});