import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveLobbySessionBan } from '../src/lobby-ban-guard.js';

test('resolveLobbySessionBan uses sim when JWT banned flag is false', async () => {
    const prev = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ banned: true }), { status: 200 });
    try {
        const ban = await resolveLobbySessionBan(
            { sub: 'student-9', banned: false },
            { LOBBY_SIM_ORIGIN: 'https://sim.test', LOBBY_SIM_SERVICE_TOKEN: 'tok' },
        );
        assert.equal(ban.banned, true);
    } finally {
        globalThis.fetch = prev;
    }
});