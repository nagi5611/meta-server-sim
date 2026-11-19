import assert from 'node:assert/strict';
import { test } from 'node:test';
import express from 'express';
import { handleAdminApi } from '../src/admin-api.js';
import { signJwt } from '../src/jwt.js';
import { isLobbySuperAdmin } from '../src/lobby-super-admin.js';

const SECRET = '0123456789abcdef0123456789abcdef';

async function startSimPatchStub(handler) {
    const app = express();
    app.use(express.json());
    app.patch('/service/users/:kind/:id', handler);
    app.get('/service/users/students', (_req, res) => res.json([]));
    app.get('/service/users/teachers', (_req, res) => res.json([]));
    app.get('/service/lobby/presence-index', (_req, res) => res.json({ entries: [] }));
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
    return {
        origin: `http://127.0.0.1:${port}`,
        close: () => server.close(),
    };
}

const envBase = {
    LOBBY_ADMIN_SESSION_SECRET: SECRET,
    LOBBY_SIM_SERVICE_TOKEN: 'svc',
};

test('isLobbySuperAdmin is true only when JWT superAdmin claim is set', () => {
    assert.equal(isLobbySuperAdmin({ superAdmin: true }), true);
    assert.equal(isLobbySuperAdmin({ superAdmin: false }), false);
    assert.equal(isLobbySuperAdmin({ role: 'admin' }), false);
    assert.equal(isLobbySuperAdmin(null), false);
});

test('GET /api/admin/session exposes superAdmin from JWT', async () => {
    const token = await signJwt({ sub: 'ops', role: 'admin', admin: true, superAdmin: true }, SECRET, 3600);
    const req = new Request('http://lobby.test/api/admin/session', {
        method: 'GET',
        headers: { cookie: `lobby_admin_session=${token}` },
    });
    const res = await handleAdminApi(req, { ...envBase }, /** @type {KVNamespace} */ ({}));
    assert.equal(res?.status, 200);
    const data = await res.json();
    assert.equal(data.user.username, 'ops');
    assert.equal(data.user.superAdmin, true);
});

test('PATCH user role returns super_admin_required for non-super-admin JWT', async () => {
    const sim = await startSimPatchStub((_req, res) => res.status(500).json({ error: 'should_not_reach' }));
    const env = { ...envBase, LOBBY_SIM_ORIGIN: sim.origin };
    const token = await signJwt({ sub: 'sensei', role: 'admin', admin: true, superAdmin: false }, SECRET, 3600);
    try {
        const req = new Request('http://lobby.test/api/admin/users/teacher-1', {
            method: 'PATCH',
            headers: {
                cookie: `lobby_admin_session=${token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ role: 'admin' }),
        });
        const res = await handleAdminApi(req, env, /** @type {KVNamespace} */ ({}));
        assert.equal(res?.status, 403);
        const data = await res.json();
        assert.equal(data.error, 'super_admin_required');
    } finally {
        sim.close();
    }
});

test('PATCH user role forwards to sim when super-admin JWT', async () => {
    let sawSuperHdr = false;
    const sim = await startSimPatchStub((req, res) => {
        sawSuperHdr = req.headers['x-lobby-super-admin'] === '1';
        res.json({ id: 1, lobbyRole: 'admin' });
    });
    const env = { ...envBase, LOBBY_SIM_ORIGIN: sim.origin };
    const token = await signJwt({ sub: 'admin', role: 'admin', admin: true, superAdmin: true }, SECRET, 3600);
    try {
        const req = new Request('http://lobby.test/api/admin/users/student-9', {
            method: 'PATCH',
            headers: {
                cookie: `lobby_admin_session=${token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ role: 'member' }),
        });
        const res = await handleAdminApi(req, env, /** @type {KVNamespace} */ ({}));
        assert.equal(res?.status, 200);
        assert.equal(sawSuperHdr, true);
    } finally {
        sim.close();
    }
});

test('PATCH user ban still allowed for lobby admin without superAdmin', async () => {
    let patchBody = null;
    const sim = await startSimPatchStub((req, res) => {
        patchBody = req.body;
        res.json({ id: 2, banned: true });
    });
    const env = { ...envBase, LOBBY_SIM_ORIGIN: sim.origin };
    const token = await signJwt({ sub: 'sensei', role: 'admin', admin: true }, SECRET, 3600);
    try {
        const req = new Request('http://lobby.test/api/admin/users/student-2', {
            method: 'PATCH',
            headers: {
                cookie: `lobby_admin_session=${token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ banned: true }),
        });
        const res = await handleAdminApi(req, env, /** @type {KVNamespace} */ ({}));
        assert.equal(res?.status, 200);
        assert.equal(patchBody?.banned, true);
        assert.equal('lobbyRole' in (patchBody || {}), false);
    } finally {
        sim.close();
    }
});