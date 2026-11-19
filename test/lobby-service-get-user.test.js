import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { initSqliteUsersDb, patchLobbyUserFlagsSqlite, registerLobbyStudentSqlite } from '../db/users-sqlite.js';
import { initUsersDb, resetUsersDbStateForTests } from '../db/users.js';
import { registerPlatformLobbyServiceRoutes } from '../lib/platform-lobby-service-routes.js';

test('GET /service/users/:kind/:id returns banned flag', async () => {
    const tmp = path.join(os.tmpdir(), `lobby-get-user-${process.pid}.db`);
    const token = `tok-${process.pid}`;
    const prevDb = process.env.USERS_DB_PATH;
    const prevTok = process.env.LOBBY_SIM_SERVICE_TOKEN;
    try {
        process.env.USERS_DB_PATH = tmp;
        process.env.LOBBY_SIM_SERVICE_TOKEN = token;
        initSqliteUsersDb(tmp);
        await initUsersDb();
        const student = registerLobbyStudentSqlite('get@example.com', 'WelcomePass8', 'Get');
        patchLobbyUserFlagsSqlite('student', student.id, { banned: true });
        const app = express();
        app.use(express.json());
        registerPlatformLobbyServiceRoutes(app);
        const server = app.listen(0);
        await new Promise((r) => server.once('listening', r));
        const port = server.address().port;
        const res = await fetch(`http://127.0.0.1:${port}/service/users/student/${student.id}`, {
            headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(res.status, 200);
        assert.equal((await res.json()).banned, true);
        await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    } finally {
        resetUsersDbStateForTests();
        if (prevDb === undefined) delete process.env.USERS_DB_PATH;
        else process.env.USERS_DB_PATH = prevDb;
        if (prevTok === undefined) delete process.env.LOBBY_SIM_SERVICE_TOKEN;
        else process.env.LOBBY_SIM_SERVICE_TOKEN = prevTok;
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
});