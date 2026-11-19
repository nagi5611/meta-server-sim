// test/lobby-service-auth.test.js

import express from 'express';
import assert from 'node:assert/strict';
import test from 'node:test';

import { registerPlatformLobbyServiceRoutes } from '../lib/platform-lobby-service-routes.js';

const ENV_KEYS = [
    'LOBBY_SIM_SERVICE_TOKEN',
    'LOBBY_SIM_SERVICE_TOKEN_PREVIOUS',
    'LOBBY_SIM_SERVICE_TOKEN_READ',
    'LOBBY_SIM_SERVICE_TOKEN_READ_PREVIOUS',
    'LOBBY_SIM_SERVICE_TOKEN_USER_WRITE',
    'LOBBY_SIM_SERVICE_TOKEN_CATALOG_WRITE',
    'LOBBY_SIM_SERVICE_TOKEN_AUTH',
    'LOBBY_SIM_SERVICE_TOKEN_KICK',
];

/**
 * @param {Record<string, string | undefined>} overrides
 */
function snapshotEnv(overrides = {}) {
    /** @type {Record<string, string | undefined>} */
    const prev = {};
    for (const key of ENV_KEYS) {
        prev[key] = process.env[key];
        if (overrides[key] === undefined) delete process.env[key];
        else process.env[key] = overrides[key];
    }
    return () => {
        for (const key of ENV_KEYS) {
            if (prev[key] === undefined) delete process.env[key];
            else process.env[key] = prev[key];
        }
    };
}

/**
 * @returns {Promise<{ base: string, close: () => Promise<void> }>}
 */
async function startServiceApp() {
    const app = express();
    app.use(express.json());
    registerPlatformLobbyServiceRoutes(app);
    const server = await new Promise((resolve) => {
        const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const addr = server.address();
    assert.ok(addr && typeof addr === 'object');
    const base = `http://127.0.0.1:${addr.port}`;
    return {
        base,
        close: () =>
            new Promise((resolve, reject) => {
                server.close((err) => (err ? reject(err) : resolve()));
            }),
    };
}

test('legacy LOBBY_SIM_SERVICE_TOKEN allows read and kick routes', async () => {
    const restore = snapshotEnv({ LOBBY_SIM_SERVICE_TOKEN: 'legacy-full-token' });
    try {
        const { base, close } = await startServiceApp();
        try {
            const catalog = await fetch(`${base}/service/lobby-catalog`, {
                headers: { authorization: 'Bearer legacy-full-token' },
            });
            assert.equal(catalog.status, 200);

            const kick = await fetch(`${base}/service/lobby/kick`, {
                method: 'POST',
                headers: {
                    authorization: 'Bearer legacy-full-token',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ userRef: 'student-1' }),
            });
            assert.notEqual(kick.status, 401);
        } finally {
            await close();
        }
    } finally {
        restore();
    }
});

test('LOBBY_SIM_SERVICE_TOKEN_PREVIOUS works during rotation', async () => {
    const restore = snapshotEnv({
        LOBBY_SIM_SERVICE_TOKEN: 'new-token',
        LOBBY_SIM_SERVICE_TOKEN_PREVIOUS: 'old-token',
    });
    try {
        const { base, close } = await startServiceApp();
        try {
            const withOld = await fetch(`${base}/service/lobby-catalog`, {
                headers: { authorization: 'Bearer old-token' },
            });
            assert.equal(withOld.status, 200);

            const withNew = await fetch(`${base}/service/lobby-catalog`, {
                headers: { authorization: 'Bearer new-token' },
            });
            assert.equal(withNew.status, 200);
        } finally {
            await close();
        }
    } finally {
        restore();
    }
});

test('scoped read token cannot call kick', async () => {
    const restore = snapshotEnv({
        LOBBY_SIM_SERVICE_TOKEN_READ: 'read-only-token',
        LOBBY_SIM_SERVICE_TOKEN_KICK: 'kick-only-token',
    });
    try {
        const { base, close } = await startServiceApp();
        try {
            const catalog = await fetch(`${base}/service/lobby-catalog`, {
                headers: { authorization: 'Bearer read-only-token' },
            });
            assert.equal(catalog.status, 200);

            const kickDenied = await fetch(`${base}/service/lobby/kick`, {
                method: 'POST',
                headers: {
                    authorization: 'Bearer read-only-token',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ userRef: 'student-1' }),
            });
            assert.equal(kickDenied.status, 401);

            const kickAllowed = await fetch(`${base}/service/lobby/kick`, {
                method: 'POST',
                headers: {
                    authorization: 'Bearer kick-only-token',
                    'content-type': 'application/json',
                },
                body: JSON.stringify({ userRef: 'student-1' }),
            });
            assert.notEqual(kickAllowed.status, 401);
        } finally {
            await close();
        }
    } finally {
        restore();
    }
});

test('wrong bearer returns 401 without leaking configuration', async () => {
    const restore = snapshotEnv({ LOBBY_SIM_SERVICE_TOKEN: 'expected-secret' });
    try {
        const { base, close } = await startServiceApp();
        try {
            const res = await fetch(`${base}/service/lobby-catalog`, {
                headers: { authorization: 'Bearer wrong-secret' },
            });
            assert.equal(res.status, 401);
            const body = await res.json();
            assert.equal(body.error, 'unauthorized');
        } finally {
            await close();
        }
    } finally {
        restore();
    }
});

test('missing any service token config yields 503', async () => {
    const restore = snapshotEnv({});
    try {
        const { base, close } = await startServiceApp();
        try {
            const res = await fetch(`${base}/service/lobby-catalog`, {
                headers: { authorization: 'Bearer anything' },
            });
            assert.equal(res.status, 503);
        } finally {
            await close();
        }
    } finally {
        restore();
    }
});