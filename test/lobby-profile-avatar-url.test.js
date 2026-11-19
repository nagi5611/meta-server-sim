import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { registerLobbyStudentSqlite } from '../db/users-sqlite.js';
import { initUsersDb } from '../db/users.js';
import { registerPlatformLobbyServiceRoutes } from '../lib/platform-lobby-service-routes.js';

test('PATCH /service/lobby/user-profile can set avatarUrl', async () => {
    const tmp = path.join(os.tmpdir(), `lobby-avatar-${process.pid}.db`);
    const prevDb = process.env.USERS_DB_PATH;
    const token = `test-token-${process.pid}`;
    const prevTok = process.env.LOBBY_SIM_SERVICE_TOKEN;
    try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        process.env.USERS_DB_PATH = tmp;
        process.env.LOBBY_SIM_SERVICE_TOKEN = token;
        await initUsersDb();
        const created = registerLobbyStudentSqlite('avatar@example.com', 'WelcomePass8', 'Avatar User');
        const avatarUrl = 'https://lobby.example/api/assets/profile-avatars/student-1.webp';
        const app = express();
        app.use(express.json());
        registerPlatformLobbyServiceRoutes(app);
        const server = app.listen(0);
        await new Promise((r) => server.once('listening', r));
        const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
        const userRef = `student-${created.id}`;
        const res = await fetch(`http://127.0.0.1:${port}/service/lobby/user-profile`, {
            method: 'PATCH',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({ userRef, avatarUrl: `${avatarUrl}?v=2` }),
        });
        const data = await res.json();
        server.close();
        assert.equal(res.status, 200);
        assert.equal(data.user.avatarUrl, `${avatarUrl}?v=2`);
    } finally {
        if (prevDb === undefined) delete process.env.USERS_DB_PATH;
        else process.env.USERS_DB_PATH = prevDb;
        if (prevTok === undefined) delete process.env.LOBBY_SIM_SERVICE_TOKEN;
        else process.env.LOBBY_SIM_SERVICE_TOKEN = prevTok;
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
});