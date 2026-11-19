import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {
    initSqliteUsersDb,
    registerLobbyStudentSqlite,
} from '../db/users-sqlite.js';
import { initUsersDb, resetUsersDbStateForTests } from '../db/users.js';
import { registerPlatformLobbyServiceRoutes } from '../lib/platform-lobby-service-routes.js';

async function withLobbyServiceDb(fn) {
    const tmp = path.join(os.tmpdir(), `lobby-super-admin-${process.pid}-${Date.now()}.db`);
    const prevDb = process.env.USERS_DB_PATH;
    const token = `test-token-${process.pid}`;
    const prevTok = process.env.LOBBY_SIM_SERVICE_TOKEN;
    try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        process.env.USERS_DB_PATH = tmp;
        process.env.LOBBY_SIM_SERVICE_TOKEN = token;
        initSqliteUsersDb(tmp);
        await initUsersDb();
        const student = registerLobbyStudentSqlite('promote@example.com', 'WelcomePass8', 'Promote Me');
        const app = express();
        app.use(express.json());
        registerPlatformLobbyServiceRoutes(app);
        const server = app.listen(0);
        await new Promise((r) => server.once('listening', r));
        const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
        const base = `http://127.0.0.1:${port}`;
        await fn({ base, token, studentId: student.id });
        await new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    } finally {
        resetUsersDbStateForTests();
        if (prevDb === undefined) delete process.env.USERS_DB_PATH;
        else process.env.USERS_DB_PATH = prevDb;
        if (prevTok === undefined) delete process.env.LOBBY_SIM_SERVICE_TOKEN;
        else process.env.LOBBY_SIM_SERVICE_TOKEN = prevTok;
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
}

test('PATCH /service/users rejects lobbyRole without x-lobby-super-admin', async () => {
    await withLobbyServiceDb(async ({ base, token, studentId }) => {
        const res = await fetch(`${base}/service/users/student/${studentId}`, {
            method: 'PATCH',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ lobbyRole: 'admin' }),
        });
        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.error, 'super_admin_required');
    });
});

test('PATCH /service/users accepts lobbyRole with x-lobby-super-admin', async () => {
    await withLobbyServiceDb(async ({ base, token, studentId }) => {
        const res = await fetch(`${base}/service/users/student/${studentId}`, {
            method: 'PATCH',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
                'x-lobby-super-admin': '1',
            },
            body: JSON.stringify({ lobbyRole: 'admin' }),
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.lobbyRole, 'admin');
    });
});

test('PATCH /service/users banned does not require super-admin header', async () => {
    await withLobbyServiceDb(async ({ base, token, studentId }) => {
        const res = await fetch(`${base}/service/users/student/${studentId}`, {
            method: 'PATCH',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ banned: true }),
        });
        assert.equal(res.status, 200);
        assert.equal(res.ok, true);
    });
});