import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {
    initSqliteUsersDb,
    patchLobbyUserFlagsSqlite,
    registerTeacherSqlite,
} from '../db/users-sqlite.js';
import { initUsersDb, resetUsersDbStateForTests } from '../db/users.js';
import { registerPlatformLobbyAuthRoutes } from '../lib/platform-lobby-auth-routes.js';

async function withLobbyAuthApp(fn) {
    const tmp = path.join(os.tmpdir(), `lobby-auth-role-${process.pid}-${Date.now()}.db`);
    const prevDb = process.env.USERS_DB_PATH;
    try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        process.env.USERS_DB_PATH = tmp;
        initSqliteUsersDb(tmp);
        await initUsersDb();
        const app = express();
        app.use(express.json());
        registerPlatformLobbyAuthRoutes(app);
        const server = app.listen(0);
        await new Promise((r) => server.once('listening', r));
        const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
        await fn(`http://127.0.0.1:${port}`);
        await new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    } finally {
        resetUsersDbStateForTests();
        if (prevDb === undefined) delete process.env.USERS_DB_PATH;
        else process.env.USERS_DB_PATH = prevDb;
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
}

test('POST /api/lobby/auth/login: teacher without lobbyRole admin gets member role', async () => {
    await withLobbyAuthApp(async (base) => {
        registerTeacherSqlite('sensei', 'TeacherPass9!', 'Sensei');
        const res = await fetch(`${base}/api/lobby/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'sensei', password: 'TeacherPass9!' }),
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.user.role, 'member');
        assert.equal(data.user.lobbyRole, 'user');
    });
});

test('POST /api/lobby/auth/login: promoted teacher gets admin role', async () => {
    await withLobbyAuthApp(async (base) => {
        const teacher = registerTeacherSqlite('adminteacher', 'TeacherPass9!', 'AdminT');
        patchLobbyUserFlagsSqlite('teacher', teacher.id, { lobbyRole: 'admin' });
        const res = await fetch(`${base}/api/lobby/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'adminteacher', password: 'TeacherPass9!' }),
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.user.role, 'admin');
        assert.equal(data.user.lobbyRole, 'admin');
    });
});