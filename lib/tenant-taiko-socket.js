// lib/tenant-taiko-socket.js — 太鼓マルチプレイ・ヒット音・時刻同期 Socket

import { isChartFeaturesEnabled } from './tenant-charts.js';

/** @type {Map<string, { slotCount: number, parts: Map<number, string>, names: Map<number, string>, ready: Map<number, boolean>, inGame: boolean, chartId: string | null, startAt: number | null, finished: Map<number, { score: number, name: string }> }>} */
const taikoMpRooms = new Map();

/**
 * @param {string} tenantId
 * @param {string} worldId
 * @param {string} groupId
 */
function taikoMpRoomKey(tenantId, worldId, groupId) {
    return `${tenantId}\0${worldId}\0${groupId}`;
}

/**
 * @param {string} tenantId
 * @param {string} worldId
 * @param {string} groupId
 */
function taikoMpRoomName(tenantId, worldId, groupId) {
    return `taiko-mp:${tenantId}:${worldId}:${groupId}`;
}

/**
 * @param {import('socket.io').Server} ioSrv
 * @param {string} tenantId
 * @param {string} socketId
 */
export function cleanupTaikoMpOnDisconnect(ioSrv, tenantId, socketId) {
    for (const [k, st] of taikoMpRooms) {
        if (!k.startsWith(`${tenantId}\0`)) continue;
        let changed = false;
        for (const [pi, sid] of [...st.parts.entries()]) {
            if (sid === socketId) {
                if (st.inGame && !st.finished.has(pi)) {
                    const name = st.names.get(pi) || `P${pi}`;
                    st.finished.set(pi, { score: 0, name });
                }
                st.parts.delete(pi);
                st.names.delete(pi);
                st.ready.delete(pi);
                changed = true;
            }
        }
        if (!changed) continue;
        const parts = {};
        for (let i = 1; i <= st.slotCount; i++) {
            parts[i] = {
                taken: st.parts.has(i),
                name: st.names.get(i) || '',
                ready: !!st.ready.get(i),
            };
        }
        const segs = k.split('\0');
        const worldId = segs[1] || '';
        const groupId = segs[2] || '';
        ioSrv.to(taikoMpRoomName(tenantId, worldId, groupId)).emit('taiko-mp-state', {
            slotCount: st.slotCount,
            parts,
            inGame: !!st.inGame,
        });
    }
}

/**
 * @param {import('socket.io').Socket} socket
 * @param {import('socket.io').Server} io
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 */
export function registerTenantTaikoSocketHandlers(socket, io, tenant) {
    if (!isChartFeaturesEnabled(tenant)) return;

    const tenantId = tenant.id;

    socket.on('taiko-time-sync', (_data, callback) => {
        if (typeof callback !== 'function') return;
        callback({ serverNow: Date.now() });
    });

    socket.on('taiko-hit', ({ multiplayer, worldId, groupId, type }) => {
        const hitType = type === 'ka' ? 'ka' : 'don';
        if (multiplayer && worldId && groupId) {
            io.to(taikoMpRoomName(tenantId, worldId, groupId)).emit('taiko-hit', {
                type: hitType,
                multiplayer: true,
                worldId,
                groupId,
                from: socket.id,
            });
            return;
        }
        const currentRoom = socket.data.currentRoom;
        if (!currentRoom) return;
        io.to(currentRoom).emit('taiko-hit', {
            type: hitType,
            multiplayer: false,
            worldId: currentRoom,
            from: socket.id,
        });
    });

    socket.on('taiko-mp-join', ({ worldId, groupId, slotCount, chartId }, cb) => {
        if (!worldId || !groupId || typeof slotCount !== 'number') {
            if (typeof cb === 'function') cb({ ok: false });
            return;
        }
        const sc = Math.min(3, Math.max(1, Math.floor(slotCount)));
        const k = taikoMpRoomKey(tenantId, worldId, groupId);
        const roomName = taikoMpRoomName(tenantId, worldId, groupId);
        socket.join(roomName);
        for (const st of taikoMpRooms.values()) {
            for (const [pi, sid] of [...st.parts.entries()]) {
                if (sid === socket.id) {
                    st.parts.delete(pi);
                    st.names.delete(pi);
                    st.ready.delete(pi);
                    st.finished.delete(pi);
                }
            }
        }
        let st = taikoMpRooms.get(k);
        if (!st || st.slotCount !== sc) {
            st = {
                slotCount: sc,
                parts: new Map(),
                names: new Map(),
                ready: new Map(),
                inGame: false,
                chartId: null,
                startAt: null,
                finished: new Map(),
            };
            taikoMpRooms.set(k, st);
        }
        if (typeof chartId === 'string' && chartId.trim()) {
            st.chartId = chartId.trim();
        }
        const parts = {};
        for (let i = 1; i <= st.slotCount; i++) {
            parts[i] = {
                taken: st.parts.has(i),
                name: st.names.get(i) || '',
                ready: !!st.ready.get(i),
            };
        }
        io.to(roomName).emit('taiko-mp-state', {
            slotCount: st.slotCount,
            parts,
            inGame: !!st.inGame,
            startAt: st.startAt,
        });
        if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('taiko-mp-leave', ({ worldId, groupId }) => {
        if (!worldId || !groupId) return;
        const roomName = taikoMpRoomName(tenantId, worldId, groupId);
        socket.leave(roomName);
        const k = taikoMpRoomKey(tenantId, worldId, groupId);
        const st = taikoMpRooms.get(k);
        if (st) {
            for (const [pi, sid] of [...st.parts.entries()]) {
                if (sid === socket.id) {
                    if (st.inGame && !st.finished.has(pi)) {
                        const name = st.names.get(pi) || `P${pi}`;
                        st.finished.set(pi, { score: 0, name });
                    }
                    st.parts.delete(pi);
                    st.names.delete(pi);
                    st.ready.delete(pi);
                }
            }
        }
        if (st) {
            const parts = {};
            for (let i = 1; i <= st.slotCount; i++) {
                parts[i] = {
                    taken: st.parts.has(i),
                    name: st.names.get(i) || '',
                    ready: !!st.ready.get(i),
                };
            }
            io.to(roomName).emit('taiko-mp-state', {
                slotCount: st.slotCount,
                parts,
                inGame: !!st.inGame,
                startAt: st.startAt,
            });
        }
    });

    socket.on('taiko-mp-claim-part', ({ worldId, groupId, partIndex }, cb) => {
        const k = taikoMpRoomKey(tenantId, worldId, groupId);
        const st = taikoMpRooms.get(k);
        if (!st) {
            if (typeof cb === 'function') cb({ ok: false, error: 'room' });
            return;
        }
        if (st.inGame) {
            if (typeof cb === 'function') cb({ ok: false, error: 'in_game' });
            return;
        }
        const p = Number(partIndex);
        if (!Number.isInteger(p) || p < 1 || p > st.slotCount) {
            if (typeof cb === 'function') cb({ ok: false, error: 'part' });
            return;
        }
        for (const [pi, sid] of [...st.parts.entries()]) {
            if (sid === socket.id) {
                st.parts.delete(pi);
                st.names.delete(pi);
                st.ready.delete(pi);
                st.finished.delete(pi);
            }
        }
        const cur = st.parts.get(p);
        if (cur && cur !== socket.id) {
            if (typeof cb === 'function') cb({ ok: false, error: 'taken' });
            return;
        }
        st.parts.set(p, socket.id);
        st.ready.set(p, false);
        const parts = {};
        for (let i = 1; i <= st.slotCount; i++) {
            parts[i] = {
                taken: st.parts.has(i),
                name: st.names.get(i) || '',
                ready: !!st.ready.get(i),
            };
        }
        const roomName = taikoMpRoomName(tenantId, worldId, groupId);
        st.startAt = null;
        io.to(roomName).emit('taiko-mp-state', {
            slotCount: st.slotCount,
            parts,
            inGame: !!st.inGame,
            startAt: st.startAt,
        });
        if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('taiko-mp-ready', ({ worldId, groupId, partIndex, ready }, cb) => {
        const k = taikoMpRoomKey(tenantId, worldId, groupId);
        const st = taikoMpRooms.get(k);
        if (!st) {
            if (typeof cb === 'function') cb({ ok: false, error: 'room' });
            return;
        }
        const p = Number(partIndex);
        if (!Number.isInteger(p) || p < 1 || p > st.slotCount) {
            if (typeof cb === 'function') cb({ ok: false, error: 'part' });
            return;
        }
        const owner = st.parts.get(p);
        if (!owner || owner !== socket.id) {
            if (typeof cb === 'function') cb({ ok: false, error: 'not_owner' });
            return;
        }
        st.ready.set(p, !!ready);

        const parts = {};
        for (let i = 1; i <= st.slotCount; i++) {
            parts[i] = {
                taken: st.parts.has(i),
                name: st.names.get(i) || '',
                ready: !!st.ready.get(i),
            };
        }

        const roomName = taikoMpRoomName(tenantId, worldId, groupId);
        const allTaken = st.parts.size >= st.slotCount;
        const allReady =
            allTaken && [...Array(st.slotCount)].every((_, idx) => !!st.ready.get(idx + 1));

        if (!st.inGame && allReady && st.chartId) {
            st.inGame = true;
            st.finished.clear();
            st.startAt = Date.now() + 4000;
            for (const [pi, sid] of st.parts.entries()) {
                io.to(sid).emit('taiko-mp-sync-start', {
                    startAt: st.startAt,
                    chartId: st.chartId,
                    partIndex: pi,
                });
            }
        }

        io.to(roomName).emit('taiko-mp-state', {
            slotCount: st.slotCount,
            parts,
            inGame: !!st.inGame,
            startAt: st.startAt,
        });
        if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('taiko-mp-set-name', ({ worldId, groupId, partIndex, name }, cb) => {
        const k = taikoMpRoomKey(tenantId, worldId, groupId);
        const st = taikoMpRooms.get(k);
        if (!st) {
            if (typeof cb === 'function') cb({ ok: false });
            return;
        }
        const p = Number(partIndex);
        if (!Number.isInteger(p) || p < 1 || p > st.slotCount) {
            if (typeof cb === 'function') cb({ ok: false });
            return;
        }
        const owner = st.parts.get(p);
        if (!owner || owner !== socket.id) {
            if (typeof cb === 'function') cb({ ok: false, error: 'not_owner' });
            return;
        }
        const s = String(name || '').trim().slice(0, 20);
        st.names.set(p, s || `P${p}`);
        const parts = {};
        for (let i = 1; i <= st.slotCount; i++) {
            parts[i] = {
                taken: st.parts.has(i),
                name: st.names.get(i) || '',
                ready: !!st.ready.get(i),
            };
        }
        io.to(taikoMpRoomName(tenantId, worldId, groupId)).emit('taiko-mp-state', {
            slotCount: st.slotCount,
            parts,
            inGame: !!st.inGame,
            startAt: st.startAt,
        });
        if (typeof cb === 'function') cb({ ok: true });
    });

    socket.on('taiko-mp-finish', ({ worldId, groupId, partIndex, score }, cb) => {
        const k = taikoMpRoomKey(tenantId, worldId, groupId);
        const st = taikoMpRooms.get(k);
        if (!st || !st.inGame) {
            if (typeof cb === 'function') cb({ ok: false });
            return;
        }
        const p = Number(partIndex);
        if (!Number.isInteger(p) || p < 1 || p > st.slotCount) {
            if (typeof cb === 'function') cb({ ok: false });
            return;
        }
        const owner = st.parts.get(p);
        if (!owner || owner !== socket.id) {
            if (typeof cb === 'function') cb({ ok: false, error: 'not_owner' });
            return;
        }
        const sc = Math.max(0, Math.floor(Number(score) || 0));
        st.finished.set(p, { score: sc, name: st.names.get(p) || `P${p}` });
        const done = st.finished.size >= st.slotCount;
        if (done) {
            const players = [];
            let totalScore = 0;
            for (let i = 1; i <= st.slotCount; i++) {
                const v = st.finished.get(i) || { score: 0, name: st.names.get(i) || `P${i}` };
                totalScore += v.score;
                players.push({ partIndex: i, name: v.name, score: v.score });
            }
            io.to(taikoMpRoomName(tenantId, worldId, groupId)).emit('taiko-mp-results', {
                chartId: st.chartId,
                totalScore,
                players,
            });
            st.inGame = false;
            st.chartId = null;
            st.parts.clear();
            st.names.clear();
            st.finished.clear();
            const parts = {};
            for (let i = 1; i <= st.slotCount; i++) {
                parts[i] = { taken: false, name: '' };
            }
            io.to(taikoMpRoomName(tenantId, worldId, groupId)).emit('taiko-mp-state', {
                slotCount: st.slotCount,
                parts,
                inGame: !!st.inGame,
            });
        }
        if (typeof cb === 'function') cb({ ok: true });
    });
}

/** @internal 単体テスト用 */
export function _resetTaikoMpRoomsForTests() {
    taikoMpRooms.clear();
}