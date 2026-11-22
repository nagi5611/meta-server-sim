// test/lobby-display-name-join-token.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    mintLobbyDisplayNameJoinToken,
    verifyLobbyDisplayNameJoinToken,
} from '../lib/lobby-display-name-join-token.js';

describe('lobby-display-name-join-token', () => {
    /** @type {string | undefined} */
    let prev;

    beforeEach(() => {
        prev = process.env.LOBBY_DISPLAY_JOIN_SECRET;
        process.env.LOBBY_DISPLAY_JOIN_SECRET = 'unit-test-ljdn-secret';
    });

    afterEach(() => {
        if (prev === undefined) delete process.env.LOBBY_DISPLAY_JOIN_SECRET;
        else process.env.LOBBY_DISPLAY_JOIN_SECRET = prev;
    });

    it('round-trips display name', () => {
        const token = mintLobbyDisplayNameJoinToken('GuestPlayer');
        assert.ok(token);
        const v = verifyLobbyDisplayNameJoinToken(token);
        assert.equal(v.ok, true);
        if (!v.ok) return;
        assert.equal(v.displayName, 'GuestPlayer');
    });
});