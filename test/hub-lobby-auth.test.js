import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { registerPlatformLobbyAuthRoutes } from '../lib/platform-lobby-auth-routes.js';
import { resolveLobbyPublicUrl } from '../lib/lobby-public-url.js';

test('platform client-config resolves production lobby URL by default', () => {
    const prev = process.env.NODE_ENV;
  const prevLobby = process.env.LOBBY_PUBLIC_URL;
    try {
        delete process.env.LOBBY_PUBLIC_URL;
        process.env.NODE_ENV = 'production';
        assert.equal(resolveLobbyPublicUrl(), 'https://m.mmh-virtual.jp/');
    } finally {
        if (prev === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prev;
        if (prevLobby === undefined) delete process.env.LOBBY_PUBLIC_URL;
        else process.env.LOBBY_PUBLIC_URL = prevLobby;
    }
});

test('POST /api/lobby/auth/login requires credentials', async () => {
    const app = express();
    app.use(express.json());
    registerPlatformLobbyAuthRoutes(app);

    const server = http.createServer(app);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();

    try {
        const res = await fetch(`http://127.0.0.1:${port}/api/lobby/auth/login`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
        });
        assert.equal(res.status, 400);
        const body = await res.json();
        assert.equal(body.error, 'username_and_password_required');
    } finally {
        await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }
});