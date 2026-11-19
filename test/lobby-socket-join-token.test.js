// test/lobby-socket-join-token.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import express from 'express';
import { registerPlatformLobbyServiceRoutes } from '../lib/platform-lobby-service-routes.js';
import { registerTenant } from '../lib/tenant-registry.js';

/** @type {string | undefined} */
let prevToken;
/** @type {string | undefined} */
let prevSecret;

function listen(app) {
    return new Promise((resolve) => {
        const server = http.createServer(app);
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            resolve({ server, port: typeof addr === 'object' && addr ? addr.port : 0 });
        });
    });
}

describe('POST /service/lobby/socket-join-token', () => {
    beforeEach(() => {
        prevToken = process.env.LOBBY_SIM_SERVICE_TOKEN;
        prevSecret = process.env.TENANT_SOCKET_SECRET;
        process.env.LOBBY_SIM_SERVICE_TOKEN = 'svc-test-token';
        delete process.env.TENANT_SOCKET_SECRET;
        registerTenant({
            id: 'P-join-test',
            displayName: 'Join test',
            enabled: true,
            rootPath: '/tmp',
            paths: {},
        });
    });

    afterEach(() => {
        if (prevToken === undefined) delete process.env.LOBBY_SIM_SERVICE_TOKEN;
        else process.env.LOBBY_SIM_SERVICE_TOKEN = prevToken;
        if (prevSecret === undefined) delete process.env.TENANT_SOCKET_SECRET;
        else process.env.TENANT_SOCKET_SECRET = prevSecret;
    });

    it('mints join token for registered tenant when secret configured', async () => {
        process.env.TENANT_SOCKET_SECRET = 'mint-key';
        const app = express();
        app.use(express.json());
        registerPlatformLobbyServiceRoutes(app);
        const { server, port } = await listen(app);
        try {
            const res = await fetch(`http://127.0.0.1:${port}/service/lobby/socket-join-token`, {
                method: 'POST',
                headers: {
                    authorization: 'Bearer svc-test-token',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ tenantId: 'P-join-test' }),
            });
            assert.equal(res.status, 200);
            const body = await res.json();
            assert.equal(body.ok, true);
            assert.match(String(body.joinToken), /^tsj1\.P-join-test\.\d+\./);
            assert.equal(body.enforced, true);
        } finally {
            server.close();
        }
    });

    it('returns null token when secret not configured', async () => {
        const app = express();
        app.use(express.json());
        registerPlatformLobbyServiceRoutes(app);
        const { server, port } = await listen(app);
        try {
            const res = await fetch(`http://127.0.0.1:${port}/service/lobby/socket-join-token`, {
                method: 'POST',
                headers: {
                    authorization: 'Bearer svc-test-token',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ tenantId: 'P-join-test' }),
            });
            const body = await res.json();
            assert.equal(body.joinToken, null);
            assert.equal(body.enforced, false);
        } finally {
            server.close();
        }
    });
});