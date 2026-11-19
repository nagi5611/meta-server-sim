import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleAdminApi } from '../src/admin-api.js';
import { signJwt } from '../src/jwt.js';

const SECRET = '0123456789abcdef0123456789abcdef';

/** @type {KVNamespace} */
const emptyKv = {
    async get() {
        return null;
    },
    async put() {},
    async delete() {},
    async list() {
        return { keys: [], list_complete: true };
    },
};

const env = { LOBBY_JWT_SECRET: SECRET, LOBBY_ADMIN_SESSION_SECRET: SECRET };

test('POST /api/admin/bootstrap-from-lobby issues admin cookie when public session is admin', async () => {
    const publicToken = await signJwt(
        { sub: 'teacher-1', username: 'sensei', displayName: 'Sensei', role: 'admin' },
        SECRET,
        3600,
    );
    const req = new Request('http://lobby.test/api/admin/bootstrap-from-lobby', {
        method: 'POST',
        headers: { cookie: `lobby_session=${publicToken}` },
    });
    const res = await handleAdminApi(req, env, emptyKv);
    assert.equal(res?.status, 200);
    const setCookie = res.headers.get('set-cookie') || '';
    assert.match(setCookie, /lobby_admin_session=/);
    const data = await res.json();
    assert.equal(data.ok, true);
    assert.equal(data.user.role, 'admin');
});

test('POST /api/admin/bootstrap-from-lobby rejects member public session', async () => {
    const publicToken = await signJwt(
        { sub: 'student-1', username: 'student', displayName: 'Student', role: 'member' },
        SECRET,
        3600,
    );
    const req = new Request('http://lobby.test/api/admin/bootstrap-from-lobby', {
        method: 'POST',
        headers: { cookie: `lobby_session=${publicToken}` },
    });
    const res = await handleAdminApi(req, env, emptyKv);
    assert.equal(res?.status, 403);
});