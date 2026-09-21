// test/tenant-player-presence.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    collectPlayersToPrune,
    findDuplicateClientSessionSockets,
    findDuplicateUsernameSockets,
    isPlayerPingStale,
    normalizeClientSessionId,
} from '../lib/tenant-player-presence.js';

describe('tenant-player-presence', () => {
    it('normalizeClientSessionId accepts uuid-like ids', () => {
        const id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        assert.equal(normalizeClientSessionId(id), id);
        assert.equal(normalizeClientSessionId(' short '), null);
    });

    it('isPlayerPingStale ignores players without pingReportedAt', () => {
        assert.equal(isPlayerPingStale({}, Date.now()), false);
        assert.equal(
            isPlayerPingStale({ pingReportedAt: Date.now() - 50000 }, Date.now()),
            true,
        );
    });

    it('collectPlayersToPrune flags disconnected and stale ping', () => {
        const roomState = {
            players: new Map([
                ['a', { pingReportedAt: Date.now() - 1000 }],
                ['b', { pingReportedAt: Date.now() - 60000 }],
                ['c', {}],
            ]),
        };
        const now = Date.now();
        const result = collectPlayersToPrune(roomState, {
            now,
            isSocketConnected: (id) => id !== 'a',
        });
        assert.deepEqual(
            result.sort((x, y) => x.socketId.localeCompare(y.socketId)),
            [
                { socketId: 'a', reason: 'disconnected' },
                { socketId: 'b', reason: 'stale_ping' },
            ],
        );
    });

    it('findDuplicateClientSessionSockets finds other sockets with same session', () => {
        const tenantRoomStates = new Map([
            [
                'P-01',
                new Map([
                    [
                        'lobby',
                        {
                            players: new Map([
                                ['keep', { clientSessionId: 'sess-12345678' }],
                                ['old', { clientSessionId: 'sess-12345678' }],
                                ['other', { clientSessionId: 'sess-99999999' }],
                            ]),
                        },
                    ],
                ]),
            ],
        ]);
        const hits = findDuplicateClientSessionSockets(
            tenantRoomStates,
            'P-01',
            'keep',
            'sess-12345678',
        );
        assert.deepEqual(hits, [{ roomId: 'lobby', socketId: 'old' }]);
    });

    it('findDuplicateUsernameSockets skips Guest', () => {
        const tenantRoomStates = new Map([
            [
                'P-01',
                new Map([
                    [
                        'lobby',
                        {
                            players: new Map([
                                ['a', { username: 'Guest' }],
                                ['b', { username: 'Guest' }],
                            ]),
                        },
                    ],
                ]),
            ],
        ]);
        assert.deepEqual(
            findDuplicateUsernameSockets(tenantRoomStates, 'P-01', 'a', 'Guest'),
            [],
        );
        const hits = findDuplicateUsernameSockets(tenantRoomStates, 'P-01', 'a', 'Taro');
        assert.deepEqual(hits, []);
    });
});
