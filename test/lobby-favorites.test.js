import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { registerLobbyStudentSqlite } from '../db/users-sqlite.js';
import { initUsersDb } from '../db/users.js';
import { registerPlatformLobbyServiceRoutes } from '../lib/platform-lobby-service-routes.js';

test('lobby favorites: list, patch, toggle via service routes', async () => {
    const tmp = path.join(os.tmpdir(), `lobby-fav-${process.pid}.db`);
    const prevDb = process.env.USERS_DB_PATH;
    const token = `test-token-fav-${process.pid}`;
    const prevTok = process.env.LOBBY_SIM_SERVICE_TOKEN;
    try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        process.env.USERS_DB_PATH = tmp;
        process.env.LOBBY_SIM_SERVICE_TOKEN = token;
        await initUsersDb();
        const created = registerLobbyStudentSqlite('fav@example.com', 'WelcomePass8', 'Fav User');
        const userRef = `student-${created.id}`;
        const app = express();
        app.use(express.json());
        registerPlatformLobbyServiceRoutes(app);
        const server = app.listen(0);
        await new Promise((r) => server.once('listening', r));
        const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
        const base = `http://127.0.0.1:${port}`;
        const headers = {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
        };

        const empty = await fetch(`${base}/service/lobby/favorites?userRef=${encodeURIComponent(userRef)}`, {
            headers: { authorization: `Bearer ${token}` },
        });
        assert.equal(empty.status, 200);
        const emptyJson = await empty.json();
        assert.deepEqual(emptyJson.worldIds, []);

        const patchRes = await fetch(`${base}/service/lobby/favorites`, {
            method: 'PATCH',
            headers,
            body: JSON.stringify({ userRef, worldId: 'tenant-p-01', favorite: true }),
        });
        assert.equal(patchRes.status, 200);
        const patchJson = await patchRes.json();
        assert.equal(patchJson.favorite, true);
        assert.deepEqual(patchJson.worldIds, ['tenant-p-01']);

        const toggleOff = await fetch(`${base}/service/lobby/favorites/toggle`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ userRef, worldId: 'tenant-p-01' }),
        });
        const toggleOffJson = await toggleOff.json();
        assert.equal(toggleOff.status, 200);
        assert.equal(toggleOffJson.favorite, false);
        assert.deepEqual(toggleOffJson.worldIds, []);

        const toggleOn = await fetch(`${base}/service/lobby/favorites/toggle`, {
            method: 'POST',
            headers,
            body: JSON.stringify({ userRef, worldId: 'tenant-p-99' }),
        });
        const toggleOnJson = await toggleOn.json();
        assert.equal(toggleOn.status, 200);
        assert.equal(toggleOnJson.favorite, true);
        assert.deepEqual(toggleOnJson.worldIds, ['tenant-p-99']);

        server.close();
    } finally {
        if (prevDb === undefined) delete process.env.USERS_DB_PATH;
        else process.env.USERS_DB_PATH = prevDb;
        if (prevTok === undefined) delete process.env.LOBBY_SIM_SERVICE_TOKEN;
        else process.env.LOBBY_SIM_SERVICE_TOKEN = prevTok;
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
});
