import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { handleAdminLogin } from '../src/admin-api.js';
import { verifyJwt } from '../src/jwt.js';

const SECRET = '0123456789abcdef0123456789abcdef';

async function startSimStub(handler) {
    const app = express();
    app.use(express.json());
    app.post('/service/lobby/admin-login', handler);
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    return {
        origin: `http://127.0.0.1:${port}`,
        close: () => server.close(),
    };
}

test('handleAdminLogin: static LOBBY_ADMIN_PASSWORD still works', async () => {
    const env = {
        LOBBY_ADMIN_USER: 'admin',
        LOBBY_ADMIN_PASSWORD: 'static-secret',
        LOBBY_ADMIN_SESSION_SECRET: SECRET,
        LOBBY_SIM_ORIGIN: 'http://127.0.0.1:9',
        LOBBY_SIM_SERVICE_TOKEN: 'unused',
    };
    const req = new Request('http://lobby.test/api/admin/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'static-secret' }),
    });
    const res = await handleAdminLogin(req, env);
    assert.equal(res?.status, 200);
    const setCookie = res.headers.get('set-cookie') || '';
    assert.match(setCookie, /lobby_admin_session=/);
    const token = setCookie.match(/lobby_admin_session=([^;]+)/)?.[1];
    assert.ok(token);
    const session = await verifyJwt(token, SECRET);
    assert.equal(session?.sub, 'admin');
    assert.equal(session?.superAdmin, true);
    const body = await res.json();
    assert.equal(body.user.superAdmin, true);
});

test('handleAdminLogin: sim teacher via email issues admin session', async () => {
    const sim = await startSimStub((req, res) => {
        const login = String(req.body?.login || req.body?.email || '').trim();
        if (login === 'sensei@school.jp' && req.body?.password === 'TeacherPass9!') {
            return res.json({ ok: true, user: { username: 'sensei', lobbyRole: 'admin' } });
        }
        return res.status(401).json({ error: 'invalid_credentials' });
    });
    const env = {
        LOBBY_ADMIN_PASSWORD: '',
        LOBBY_ADMIN_SESSION_SECRET: SECRET,
        LOBBY_SIM_ORIGIN: sim.origin,
        LOBBY_SIM_SERVICE_TOKEN: 'svc-token',
    };
    try {
        const req = new Request('http://lobby.test/api/admin/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ email: 'sensei@school.jp', password: 'TeacherPass9!' }),
        });
        const res = await handleAdminLogin(req, env);
        assert.equal(res?.status, 200);
        const data = await res.json();
        assert.equal(data.user.username, 'sensei');
        assert.equal(data.user.superAdmin, false);
        const setCookie = res.headers.get('set-cookie') || '';
        const token = setCookie.match(/lobby_admin_session=([^;]+)/)?.[1];
        const session = token ? await verifyJwt(token, SECRET) : null;
        assert.equal(session?.superAdmin, false);
    } finally {
        sim.close();
    }
});

test('handleAdminLogin: forwards admin_required from sim', async () => {
    const sim = await startSimStub((_req, res) => res.status(403).json({ error: 'admin_required' }));
    const env = {
        LOBBY_ADMIN_PASSWORD: '',
        LOBBY_ADMIN_SESSION_SECRET: SECRET,
        LOBBY_SIM_ORIGIN: sim.origin,
        LOBBY_SIM_SERVICE_TOKEN: 'svc-token',
    };
    try {
        const req = new Request('http://lobby.test/api/admin/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'student', password: 'WelcomePass8' }),
        });
        const res = await handleAdminLogin(req, env);
        assert.equal(res?.status, 403);
        const data = await res.json();
        assert.equal(data.error, 'admin_required');
    } finally {
        sim.close();
    }
});

test('handleAdminLogin: rejects when sim returns no user', async () => {
    const sim = await startSimStub((_req, res) => res.status(401).json({ error: 'invalid_credentials' }));
    const env = {
        LOBBY_ADMIN_PASSWORD: 'only-static',
        LOBBY_ADMIN_USER: 'admin',
        LOBBY_ADMIN_SESSION_SECRET: SECRET,
        LOBBY_SIM_ORIGIN: sim.origin,
        LOBBY_SIM_SERVICE_TOKEN: 'svc-token',
    };
    try {
        const req = new Request('http://lobby.test/api/admin/login', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'teacher', password: 'nope' }),
        });
        const res = await handleAdminLogin(req, env);
        assert.equal(res?.status, 401);
    } finally {
        sim.close();
    }
});