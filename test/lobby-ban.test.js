import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { banLifecycleState, isBanActive, normalizeBanExpiresAt } from '../lib/lobby-ban.js';
import {
    initSqliteUsersDb,
    patchLobbyUserFlagsSqlite,
    registerLobbyStudentSqlite,
    listBanHistorySqlite,
    getLobbyUserByIdSqlite,
} from '../db/users-sqlite.js';
import { initUsersDb, resetUsersDbStateForTests } from '../db/users.js';
import { registerPlatformLobbyServiceRoutes } from '../lib/platform-lobby-service-routes.js';
import { registerPlatformLobbyAuthRoutes } from '../lib/platform-lobby-auth-routes.js';

test('lobby-ban helpers', () => {
    assert.equal(normalizeBanExpiresAt(''), null);
    assert.equal(isBanActive(true, null), true);
    const past = new Date(Date.now() - 60_000).toISOString();
    assert.equal(isBanActive(true, past), false);
    assert.equal(banLifecycleState(1, past), 'expired');
});

async function withBanDb(fn) {
    const tmp = path.join(os.tmpdir(), `lobby-ban-${process.pid}-${Date.now()}.db`);
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
        registerPlatformLobbyAuthRoutes(app);
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

test('timed ban expires on read and records history', async () => {
    await withBanDb(async () => {
        const student = registerLobbyStudentSqlite('ban@example.com', 'WelcomePass8', 'Banned');
        const past = new Date(Date.now() - 5_000).toISOString();
        patchLobbyUserFlagsSqlite('student', student.id, {
            banned: true,
            banExpiresAt: past,
            actor: 'admin@test',
        });
        const lifted = getLobbyUserByIdSqlite('student', student.id);
        assert.equal(lifted.banned, false);
        const history = listBanHistorySqlite('student', student.id);
        assert.ok(history.some((h) => h.action === 'ban'));
        assert.ok(history.some((h) => h.action === 'expire'));
    });
});

test('login rejects active ban and accepts after unban', async () => {
    await withBanDb(async ({ base }) => {
        const student = registerLobbyStudentSqlite('active@example.com', 'WelcomePass8', 'Active');
        patchLobbyUserFlagsSqlite('student', student.id, {
            banned: true,
            banExpiresAt: null,
            actor: 'mod',
        });

        const bannedRes = await fetch(`${base}/api/lobby/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'active@example.com', password: 'WelcomePass8' }),
        });
        assert.equal(bannedRes.status, 403);

        await fetch(`${base}/service/users/student/${student.id}`, {
            method: 'PATCH',
            headers: {
                authorization: `Bearer ${process.env.LOBBY_SIM_SERVICE_TOKEN}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ banned: false, actor: 'mod' }),
        });

        const okRes = await fetch(`${base}/api/lobby/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ username: 'active@example.com', password: 'WelcomePass8' }),
        });
        assert.equal(okRes.status, 200);
    });
});
