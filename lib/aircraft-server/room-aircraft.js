// lib/aircraft-server/room-aircraft.js — ルーム内 aircraft 状態の更新・解放・スナップショット

import { getAircraftServerDeps } from './deps-registry.js';

/**
 * @param {{ aircraft?: { pilots: Map<string, string>, poses: Map<string, object> } }} rs
 */
export function ensureRoomAircraftState(rs) {
    if (!rs.aircraft) {
        rs.aircraft = { pilots: new Map(), poses: new Map() };
    }
}

/**
 * @param {string} worldId
 * @param {string} slotId
 * @returns {boolean}
 */
export function worldContainsAircraftSlot(worldId, slotId, tenantId) {
    const deps = getAircraftServerDeps(tenantId);
    if (!deps) return false;
    const worlds = deps.readWorlds();
    const w = worlds[worldId];
    if (!w || !Array.isArray(/** @type {Record<string, unknown>} */ (w).models)) return false;
    const sid = String(slotId || '').trim();
    return /** @type {unknown[]} */ (/** @type {Record<string, unknown>} */ (w).models).some(
        (m) => {
            const a = m && typeof m === 'object' ? /** @type {Record<string, unknown>} */ (m).aircraft : null;
            return a && String(/** @type {Record<string, unknown>} */ (a).id || '').trim() === sid;
        }
    );
}

/**
 * @param {import('socket.io').Server} ioSrv
 * @param {string} roomId
 * @param {string} socketId
 */
/**
 * ルーム内の孤立した操縦占有（players と pilots の不整合）を除去する
 * @param {{ players: Map<string, { pilotingAircraftId?: string|null }>, aircraft?: { pilots: Map<string, string>, poses: Map<string, object> } }} rs
 * @returns {string[]} 解放した slotId
 */
export function pruneStaleAircraftPilots(rs) {
    ensureRoomAircraftState(rs);
    const removed = [];
    for (const [slotId, pilotSocketId] of [...rs.aircraft.pilots]) {
        const pl = rs.players.get(pilotSocketId);
        if (!pl || String(pl.pilotingAircraftId || '').trim() !== String(slotId)) {
            rs.aircraft.pilots.delete(slotId);
            rs.aircraft.poses.delete(slotId);
            removed.push(slotId);
        }
    }
    for (const [socketId, pl] of rs.players) {
        if (!pl) continue;
        const slotId = String(pl.pilotingAircraftId || '').trim();
        if (!slotId) continue;
        if (rs.aircraft.pilots.get(slotId) !== socketId) {
            pl.pilotingAircraftId = null;
            pl.passengeringAircraftId = null;
        }
    }
    return removed;
}

/**
 * @param {{ players: Map<string, { pilotingAircraftId?: string|null, passengeringAircraftId?: string|null }>, aircraft?: { pilots: Map<string, string>, poses: Map<string, object> } }} rs
 * @param {string} socketId
 * @param {string} slotId
 * @returns {{ ok: boolean, released: boolean, error?: string }}
 */
export function releaseAircraftSlotForSocket(rs, socketId, slotId) {
    ensureRoomAircraftState(rs);
    const sid = String(slotId || '').trim();
    if (!sid) {
        return { ok: false, released: false, error: 'bad_slot' };
    }
    const pl = rs.players.get(socketId);
    let released = false;
    if (rs.aircraft.pilots.get(sid) === socketId) {
        rs.aircraft.pilots.delete(sid);
        rs.aircraft.poses.delete(sid);
        released = true;
    }
    if (pl && String(pl.pilotingAircraftId || '').trim() === sid) {
        pl.pilotingAircraftId = null;
        pl.passengeringAircraftId = null;
        released = true;
    }
    const stillBlocked = rs.aircraft.pilots.has(sid);
    if (released || !stillBlocked) {
        return { ok: true, released };
    }
    return { ok: false, released: false, error: 'not_pilot' };
}

export function releaseAllAircraftForPlayerInRoom(ioSrv, roomId, socketId, tenantId) {
    const deps = getAircraftServerDeps(tenantId);
    if (!deps) return;
    const rs = deps.getRoomState(roomId);
    if (!rs || !rs.aircraft) return;
    const released = [];
    for (const [slotId, pilotId] of rs.aircraft.pilots) {
        if (pilotId === socketId) {
            rs.aircraft.pilots.delete(slotId);
            rs.aircraft.poses.delete(slotId);
            released.push(slotId);
        }
    }
    const player = rs.players.get(socketId);
    if (player) {
        player.pilotingAircraftId = null;
        player.passengeringAircraftId = null;
    }
    for (const slotId of released) {
        ioSrv.to(roomId).emit('aircraft-released', { slotId });
    }
}

/**
 * @param {{ aircraft?: { pilots: Map<string, string>, poses: Map<string, { position: object, quaternion: object }> } }} rs
 * @returns {{ id: string, pilotId: string, position: object, quaternion: object }[]}
 */
export function buildAircraftSnapshotList(rs) {
    if (!rs?.aircraft?.pilots?.size) return [];
    const list = [];
    for (const [slotId, pilotSocketId] of rs.aircraft.pilots) {
        const pose = rs.aircraft.poses.get(slotId);
        if (!pose || !pose.position || !pose.quaternion) {
            list.push({ id: slotId, pilotId: pilotSocketId });
            continue;
        }
        const p = pose.position;
        const q = pose.quaternion;
        if (![p.x, p.y, p.z].every((n) => typeof n === 'number' && Number.isFinite(n))) {
            list.push({ id: slotId, pilotId: pilotSocketId });
            continue;
        }
        if (![q.x, q.y, q.z, q.w].every((n) => typeof n === 'number' && Number.isFinite(n))) {
            list.push({ id: slotId, pilotId: pilotSocketId });
            continue;
        }
        list.push({
            id: slotId,
            pilotId: pilotSocketId,
            position: { x: p.x, y: p.y, z: p.z },
            quaternion: { x: q.x, y: q.y, z: q.z, w: q.w },
        });
    }
    return list;
}

/**
 * player-update での機体ポーズ反映
 * @param {object} roomState getRoomState の戻り
 * @param {object} player
 * @param {object} data
 * @param {number} incomingTimestamp
 */
export function applyAircraftPoseFromPlayerUpdate(roomState, player, data, incomingTimestamp) {
    const pilotSlot = player.pilotingAircraftId;
    if (
        !pilotSlot ||
        !data.aircraftPose ||
        String(data.aircraftPose.slotId || '') !== String(pilotSlot)
    ) {
        return;
    }
    ensureRoomAircraftState(roomState);
    const ap = data.aircraftPose;
    const pq = ap.position;
    const qq = ap.quaternion;
    if (
        pq &&
        qq &&
        [pq.x, pq.y, pq.z].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
        [qq.x, qq.y, qq.z, qq.w].every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
        roomState.aircraft.poses.set(pilotSlot, {
            position: { x: pq.x, y: pq.y, z: pq.z },
            quaternion: { x: qq.x, y: qq.y, z: qq.z, w: qq.w },
            timestamp: incomingTimestamp,
        });
    }
}
