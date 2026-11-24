// lib/aircraft-server/room-aircraft-occupancy.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    ensureRoomAircraftState,
    pruneStaleAircraftPilots,
    releaseAircraftSlotForSocket,
} from './room-aircraft.js';

/**
 * @returns {{ players: Map<string, { pilotingAircraftId?: string|null, passengeringAircraftId?: string|null }>, aircraft: { pilots: Map<string, string>, poses: Map<string, object> } }}
 */
function emptyRoom() {
    const rs = { players: new Map() };
    ensureRoomAircraftState(rs);
    return rs;
}

test('pruneStaleAircraftPilots removes pilot when socket left the room', () => {
    const rs = emptyRoom();
    rs.aircraft.pilots.set('p01-scenario-b787', 'sock-dead');
    rs.aircraft.poses.set('p01-scenario-b787', { position: { x: 0, y: 0, z: 0 } });
    const removed = pruneStaleAircraftPilots(rs);
    assert.deepEqual(removed, ['p01-scenario-b787']);
    assert.equal(rs.aircraft.pilots.size, 0);
});

test('pruneStaleAircraftPilots clears player pilotingAircraftId when pilots map disagrees', () => {
    const rs = emptyRoom();
    rs.players.set('sock-a', { pilotingAircraftId: 'slot-1', passengeringAircraftId: null });
    rs.aircraft.pilots.set('slot-2', 'sock-b');
    pruneStaleAircraftPilots(rs);
    assert.equal(rs.players.get('sock-a').pilotingAircraftId, null);
});

test('releaseAircraftSlotForSocket is idempotent when slot already free', () => {
    const rs = emptyRoom();
    rs.players.set('sock-a', { pilotingAircraftId: null, passengeringAircraftId: null });
    const r = releaseAircraftSlotForSocket(rs, 'sock-a', 'slot-1');
    assert.equal(r.ok, true);
    assert.equal(r.released, false);
});

test('releaseAircraftSlotForSocket clears player flag even if pilots map mismatched', () => {
    const rs = emptyRoom();
    rs.players.set('sock-a', { pilotingAircraftId: 'slot-1', passengeringAircraftId: null });
    rs.aircraft.pilots.set('slot-1', 'sock-other');
    const r = releaseAircraftSlotForSocket(rs, 'sock-a', 'slot-1');
    assert.equal(r.ok, true);
    assert.equal(r.released, true);
    assert.equal(rs.players.get('sock-a').pilotingAircraftId, null);
    assert.equal(rs.aircraft.pilots.get('slot-1'), 'sock-other');
});