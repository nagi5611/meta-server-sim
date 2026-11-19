import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import {
    initSqliteUsersDb,
    completeLobbyGoogleAuthSqlite,
    peekLobbyGoogleAuthSqlite,
    registerLobbyStudentSqlite,
    verifyStudentSqlite,
} from '../db/users-sqlite.js';
import { registerPlatformLobbyServiceRoutes } from '../lib/platform-lobby-service-routes.js';
import { initUsersDb, resetUsersDbStateForTests } from '../db/users.js';

function listen(app) {
    return new Promise((resolve) => {
        const server = app.listen(0, '127.0.0.1', () => resolve(server));
    });
}

test('completeLobbyGoogleAuth: create, login, and link email/password account', () => {
    const tmp = path.join(os.tmpdir(), `lobby-google-${process.pid}.db`);
    try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        initSqliteUsersDb(tmp);

        assert.deepEqual(peekLobbyGoogleAuthSqlite('google-sub-1', 'google@example.com'), { action: 'create' });
        const created = completeLobbyGoogleAuthSqlite({
            googleSub: 'google-sub-1',
            email: 'google@example.com',
            displayName: 'Google User',
            emailVerified: true,
        });
        assert.equal(created.kind, 'student');
        assert.equal(created.user.username, 'google@example.com');

        assert.deepEqual(peekLobbyGoogleAuthSqlite('google-sub-1', 'google@example.com'), {
            action: 'login',
            kind: 'student',
        });
        const again = completeLobbyGoogleAuthSqlite({
            googleSub: 'google-sub-1',
            email: 'google@example.com',
            emailVerified: true,
        });
        assert.equal(again.user.id, created.user.id);

        registerLobbyStudentSqlite('legacy@example.com', 'WelcomePass8', 'Legacy');
        assert.deepEqual(peekLobbyGoogleAuthSqlite('google-sub-legacy', 'legacy@example.com'), {
            action: 'link',
            kind: 'student',
        });
        const linked = completeLobbyGoogleAuthSqlite({
            googleSub: 'google-sub-legacy',
            email: 'legacy@example.com',
            emailVerified: true,
        });
        assert.equal(linked.user.displayName, 'Legacy');
        assert.ok(verifyStudentSqlite('legacy@example.com', 'WelcomePass8'));
    } finally {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
    }
});

test('POST /service/lobby/auth/google issues lobby user json', async () => {
    const tmp = path.join(os.tmpdir(), `lobby-google-svc-${process.pid}.db`);
    const prevTok = process.env.LOBBY_SIM_SERVICE_TOKEN;
    const token = 'test-service-token-google';
    let server;
    try {
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        resetUsersDbStateForTests();
        process.env.LOBBY_SIM_SERVICE_TOKEN = token;
        initSqliteUsersDb(tmp);
        await initUsersDb();

        const app = express();
        app.use(express.json());
        registerPlatformLobbyServiceRoutes(app);
        server = await listen(app);
        const { port } = server.address();

        const res = await fetch(`http://127.0.0.1:${port}/service/lobby/auth/google`, {
            method: 'POST',
            headers: {
                authorization: `Bearer ${token}`,
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                googleSub: 'svc-google-sub',
                email: 'svc@example.com',
                emailVerified: true,
                displayName: 'Svc Google',
            }),
        });
        assert.equal(res.status, 200);
        const data = await res.json();
        assert.equal(data.ok, true);
        assert.equal(data.user.userId, 'student-1');
        assert.equal(data.user.username, 'svc@example.com');
    } finally {
        server?.close();
        resetUsersDbStateForTests();
        if (fs.existsSync(tmp)) fs.unlinkSync(tmp);
        if (prevTok === undefined) delete process.env.LOBBY_SIM_SERVICE_TOKEN;
        else process.env.LOBBY_SIM_SERVICE_TOKEN = prevTok;
    }
});