import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {
    initSqliteUsersDb,
    patchLobbyUserFlagsSqlite,
    registerLobbyStudentSqlite,
    registerTeacherSqlite,
} from '../db/users-sqlite.js';
import { initUsersDb, resetUsersDbStateForTests } from '../db/users.js';
import { registerPlatformLobbyServiceRoutes } from '../lib/platform-lobby-service-routes.js';

async function withLobbyServiceDb(fn) {
    const tmp = path.join(os.tmpdir(), `lobby-admin-login-${process.pid}-${Date.now()}.db`);
    const prevDb = process.env.USERS_DB_PATH;
    const token = `test-token-${process.pid}`;
    const prevTok = process.env.LOBBY_SIM_SERVICE_TOKEN;
    try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        process.env.USERS_DB_PATH = tmp;
        process.env.LOBBY_SIM_SERVICE_TOKEN = token;
        initSqliteUsersDb(tmp);
        await initUsersDb();
        const app = express();
        app.use(express.json());
        registerPlatformLobbyServiceRoutes(app);
        const server = app.listen(0);
        await new Promise((r) => server.once('listening', r));
        const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
        const base = `http://127.0.0.1:${port}`;
        await fn({ base, token, tmp });
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

async function postAdminLogin(base, token, body) {
    return fetch(`${base}/service/lobby/admin-login`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
        },
        body: JSON.stringify(body),
    });
}

test('POST /service/lobby/admin-login accepts teacher username or email', async () => {
    await withLobbyServiceDb(async ({ base, token }) => {
        const teacher = registerTeacherSqlite('sensei', 'TeacherPass9!', 'Sensei');
        patchLobbyUserFlagsSqlite('teacher', teacher.id, { email: 'sensei@school.jp' });

        const byUser = await postAdminLogin(base, token, { login: 'sensei', password: 'TeacherPass9!' });
        assert.equal(byUser.status, 200);
        const userData = await byUser.json();
        assert.equal(userData.user.username, 'sensei');
        assert.equal(userData.user.lobbyRole, 'admin');

        const byEmail = await postAdminLogin(base, token, {
            email: 'sensei@school.jp',
            password: 'TeacherPass9!',
        });
        assert.equal(byEmail.status, 200);
    });
});

test('POST /service/lobby/admin-login accepts student with lobbyRole admin', async () => {
    await withLobbyServiceDb(async ({ base, token }) => {
        const student = registerLobbyStudentSqlite('adminmod@example.com', 'WelcomePass8', 'Mod');
        patchLobbyUserFlagsSqlite('student', student.id, { lobbyRole: 'admin' });

        const res = await postAdminLogin(base, token, {
            login: 'adminmod@example.com',
            password: 'WelcomePass8',
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.user.kind, 'student');
        assert.equal(data.user.lobbyRole, 'admin');
    });
});

test('POST /service/lobby/admin-login rejects member student', async () => {
    await withLobbyServiceDb(async ({ base, token }) => {
        registerLobbyStudentSqlite('member@example.com', 'WelcomePass8', 'Member');
        const res = await postAdminLogin(base, token, {
            login: 'member@example.com',
            password: 'WelcomePass8',
        });
        assert.equal(res.status, 403);
        const data = await res.json();
        assert.equal(data.error, 'admin_required');
    });
});

test('POST /service/lobby/admin-login rejects bad password', async () => {
    await withLobbyServiceDb(async ({ base, token }) => {
        registerTeacherSqlite('t2', 'TeacherPass9!', 'T2');
        const res = await postAdminLogin(base, token, { login: 't2', password: 'wrong' });
        assert.equal(res.status, 401);
        assert.equal((await res.json()).error, 'invalid_credentials');
    });
});