// lib/tenant-socket.js — テナント別 Socket.io（metaverse-simple コアプロトコル互換）

import { Server } from 'socket.io';

import { readTenantWorlds } from './tenant-api.js';
import {
    applyAdminTokenToSocket,
    cleanupTenantMediaOnDisconnect,
    ensureTenantMediasoupWorkers,
    handleTenantMediaRoomChange,
    registerTenantMenuSocketHandlers,
} from './tenant-socket-features.js';
import {
    collectPlayersToPrune,
    findDuplicateClientSessionSockets,
    findDuplicateUsernameSockets,
    normalizeClientSessionId,
} from './tenant-player-presence.js';
import {
    applyAdminKickToSocket,
    replyAdminKickPlayer,
    resolveAdminKickPlayerRequest,
    buildAdminKickRejectionPayload,
} from './tenant-admin-kick.js';



const DEFAULT_ROOM = 'lobby';

const PLAYERS_UPDATE_INTERVAL_MS = 33;
const PING_STALE_MS = 15000;



/** @type {Map<string, Map<string, { players: Map<string, object> }>>} */

const tenantRoomStates = new Map();



/** @type {Map<string, import('socket.io').Server>} */

const tenantIoServers = new Map();



/** @type {Map<string, ReturnType<typeof setInterval>>} */

const tenantTickTimers = new Map();

/**
 * tenant 用 Socket.io を解放する（共有 http.Server は閉じない）
 * @param {import('socket.io').Server | undefined} io
 */
function disposeTenantSocketServer(io) {
    if (!io) return;
    try {
        io.disconnectSockets(true);
        io.removeAllListeners();
        // io.close() は共有 httpServer まで閉じるため使用しない
    } catch {
        /* ignore */
    }
}



/**

 * @param {string} animState

 * @returns {string}

 */

function normalizePlayerAnimState(animState) {

    const s = String(animState ?? 'idle').trim().toLowerCase();

    if (s === 'walk' || s === 'run' || s === 'jump' || s === 'idle') return s;

    return 'idle';

}



/**

 * tenant の room state を取得または作成

 * @param {string} tenantId

 * @param {string} roomId

 */

function getTenantRoomState(tenantId, roomId) {

    if (!tenantRoomStates.has(tenantId)) {

        tenantRoomStates.set(tenantId, new Map());

    }

    const byTenant = tenantRoomStates.get(tenantId);

    if (!byTenant.has(roomId)) {

        byTenant.set(roomId, { players: new Map() });

    }

    return byTenant.get(roomId);

}



/**

 * worlds.json に存在する room ID か

 * @param {import('./tenant-registry.js').TenantRecord} tenant

 * @param {string} roomId

 */

function isValidRoomForTenant(tenant, roomId) {

    const worlds = readTenantWorlds(tenant);

    if (!worlds) return roomId === DEFAULT_ROOM;

    return Object.prototype.hasOwnProperty.call(worlds, roomId);

}



/**

 * @param {object} player

 * @returns {string}

 */

function getPlayerDisplayName(player) {

    return String(player.username || 'Guest').trim() || 'Guest';

}



/**

 * @param {object} player

 * @returns {object}

 */

function serializePlayerForSnapshot(player) {
    const now = Date.now();
    const pingFresh =
        player.pingReportedAt != null &&
        typeof player.pingReportedAt === 'number' &&
        (now - player.pingReportedAt) < PING_STALE_MS;
    const pingMs = pingFresh && player.pingMs != null ? player.pingMs : null;
    const fpsSample = pingFresh && player.fpsSample != null ? player.fpsSample : null;
    const perfTier = pingFresh && player.perfTier ? player.perfTier : null;

    return {
        id: player.id,
        username: player.username,
        displayName: getPlayerDisplayName(player),
        position: player.position,
        rotation: player.rotation,
        quaternion: player.quaternion,
        world: player.world,
        adminInvisible: !!player.adminInvisible,
        adminCameraMode: false,
        pilotingAircraftId: null,
        passengeringAircraftId: null,
        animState: normalizePlayerAnimState(player.animState),
        avatarId: player.avatarId || null,
        vcMicOn: false,
        vcSpeakerOn: false,
        vcVideoOn: false,
        pingMs,
        fpsSample,
        perfTier,
        role: undefined,
    };
}



/**

 * ルーム内プレイヤーを players-update で配信

 * @param {import('socket.io').Server} io

 * @param {string} roomId

 * @param {ReturnType<typeof getTenantRoomState>} roomState

 */

/**
 * ルームからプレイヤーを除去し player-left を配信する
 * @param {import('socket.io').Server} io
 * @param {string} roomId
 * @param {ReturnType<typeof getTenantRoomState>} roomState
 * @param {string} socketId
 * @param {{ disconnectSocket?: boolean }} [options]
 * @returns {boolean}
 */
function removePlayerFromRoom(io, roomId, roomState, socketId, options = {}) {
    if (!roomState.players.has(socketId)) return false;

    if (options.disconnectSocket) {
        const sock = io.sockets.sockets.get(socketId);
        if (sock) {
            try {
                sock.disconnect(true);
            } catch {
                /* ignore */
            }
        }
    }

    roomState.players.delete(socketId);
    io.to(roomId).emit('player-left', socketId);
    return true;
}

/**
 * 切断済み・ping 途切れのプレイヤーをルーム状態から掃除する
 * @param {import('socket.io').Server} io
 * @param {string} tenantId
 * @param {string} roomId
 * @param {ReturnType<typeof getTenantRoomState>} roomState
 */
function reconcileRoomPlayers(io, tenantId, roomId, roomState) {
    const now = Date.now();
    const toRemove = collectPlayersToPrune(roomState, {
        now,
        isSocketConnected: (socketId) => {
            const sock = io.sockets.sockets.get(socketId);
            return !!(sock && sock.connected);
        },
    });

    if (toRemove.length === 0) return;

    for (const { socketId, reason } of toRemove) {
        removePlayerFromRoom(io, roomId, roomState, socketId, {
            disconnectSocket: reason === 'stale_ping',
        });
    }
}

/**
 * 同一ブラウザセッション・同一ユーザー名の古い接続を切断する
 * @param {import('socket.io').Server} io
 * @param {string} tenantId
 * @param {import('socket.io').Socket} keepSocket
 * @param {{ clientSessionId?: string | null, username?: string }} identity
 */
function evictSupersededPlayerSessions(io, tenantId, keepSocket, identity = {}) {
    const affectedRooms = new Set();

    const clientSessionId = identity.clientSessionId
        ? normalizeClientSessionId(identity.clientSessionId)
        : null;
    if (clientSessionId) {
        for (const { roomId, socketId } of findDuplicateClientSessionSockets(
            tenantRoomStates,
            tenantId,
            keepSocket.id,
            clientSessionId,
        )) {
            const roomState = getTenantRoomState(tenantId, roomId);
            if (removePlayerFromRoom(io, roomId, roomState, socketId, { disconnectSocket: true })) {
                affectedRooms.add(roomId);
            }
        }
    }

    const username = identity.username;
    if (username) {
        for (const { roomId, socketId } of findDuplicateUsernameSockets(
            tenantRoomStates,
            tenantId,
            keepSocket.id,
            username,
        )) {
            const roomState = getTenantRoomState(tenantId, roomId);
            if (removePlayerFromRoom(io, roomId, roomState, socketId, { disconnectSocket: true })) {
                affectedRooms.add(roomId);
            }
        }
    }

    for (const roomId of affectedRooms) {
        emitPlayersUpdate(io, roomId, getTenantRoomState(tenantId, roomId));
    }
}

function emitPlayersUpdate(io, roomId, roomState) {

    const tickTimestamp = Date.now();

    const playersArray = [...roomState.players.values()]

        .filter((p) => !p.adminInvisible && !p.adminCameraMode)

        .map((p) => serializePlayerForSnapshot(p));



    io.to(roomId).emit('players-update', {

        timestamp: tickTimestamp,

        players: playersArray,

        aircraft: [],

    });

}



/**

 * プレイヤーを別ルームへ移動

 * @param {import('socket.io').Server} io

 * @param {import('./tenant-registry.js').TenantRecord} tenant

 * @param {import('socket.io').Socket} socket

 * @param {object} playerState

 * @param {string} oldRoom

 * @param {string} newRoom

 */

function movePlayerToRoom(io, tenant, socket, playerState, oldRoom, newRoom) {

    const oldState = getTenantRoomState(tenant.id, oldRoom);

    oldState.players.delete(socket.id);

    socket.leave(oldRoom);



    socket.join(newRoom);

    socket.data.currentRoom = newRoom;

    playerState.world = newRoom;



    const newState = getTenantRoomState(tenant.id, newRoom);

    newState.players.set(socket.id, playerState);



    socket.to(oldRoom).emit('player-left', socket.id);

    socket.to(newRoom).emit('player-joined', playerState);

    emitPlayersUpdate(io, oldRoom, oldState);

    emitPlayersUpdate(io, newRoom, newState);

}



/**

 * tenant 用 Socket.io ハンドラを登録

 * @param {import('socket.io').Server} io

 * @param {import('./tenant-registry.js').TenantRecord} tenant

 */

function attachTenantSocketHandlers(io, tenant) {

    void ensureTenantMediasoupWorkers().catch((err) => {
        console.error(`[tenant:${tenant.id}] mediasoup init failed:`, err);
    });

    io.on('connection', (socket) => {

        try {

            applyAdminTokenToSocket(socket);

            const roomId = DEFAULT_ROOM;

            if (!isValidRoomForTenant(tenant, roomId)) {

                socket.emit('error', { message: 'invalid_room' });

                socket.disconnect(true);

                return;

            }



            socket.join(roomId);

            socket.data.tenantId = tenant.id;

            socket.data.currentRoom = roomId;



            const roomState = getTenantRoomState(tenant.id, roomId);

            reconcileRoomPlayers(io, tenant.id, roomId, roomState);

            const clientSessionId = normalizeClientSessionId(socket.handshake.auth?.clientSessionId);
            socket.data.clientSessionId = clientSessionId;

            const playerState = {

                id: socket.id,

                username: socket.data.isAdmin ? 'admin' : 'Guest',

                position: { x: 0, y: 10, z: 0 },

                rotation: { x: 0, y: 0, z: 0 },

                quaternion: { x: 0, y: 0, z: 0, w: 1 },

                world: roomId,

                timestamp: Date.now(),

                animState: 'idle',

                adminInvisible: false,

                isAdmin: !!socket.data.isAdmin,

                pingMs: null,

                pingReportedAt: null,

                fpsSample: null,

                perfTier: null,

                avatarId: null,

                uiLocale: 'ja',

                clientSessionId: clientSessionId ?? null,

            };

            roomState.players.set(socket.id, playerState);

            evictSupersededPlayerSessions(io, tenant.id, socket, {
                clientSessionId,
                username: playerState.username,
            });

            socket.emit('sim:hello', {

                service: 'metaverse-simulation-tenant',

                tenantId: tenant.id,

                id: socket.id,

            });



            const currentPlayers = [...roomState.players.values()];

            socket.emit('current-players', currentPlayers);

            socket.to(roomId).emit('player-joined', playerState);

            emitPlayersUpdate(io, roomId, roomState);



            registerTenantMenuSocketHandlers(socket, io, tenant, {
                getRoomState: getTenantRoomState,
                isValidWorld: (worldId) => isValidRoomForTenant(tenant, worldId),
            });



            socket.on('ping', (data, callback) => {

                if (typeof callback === 'function') {

                    callback({ ts: data?.ts ?? Date.now() });

                }

            });



            socket.on('report-ping', (payload) => {

                try {

                    const pingMs = payload && typeof payload.pingMs === 'number' ? payload.pingMs : NaN;

                    if (!(pingMs >= 0 && pingMs < 10000)) return;

                    const fpsSample =
                        payload.fpsSample != null &&
                        typeof payload.fpsSample === 'number' &&
                        Number.isFinite(payload.fpsSample)
                            ? Math.max(0, Math.min(1000, Math.floor(payload.fpsSample)))
                            : null;

                    let perfTier = payload.perfTier;

                    if (perfTier !== 'low' && perfTier !== 'medium' && perfTier !== 'high') {

                        perfTier =
                            fpsSample != null
                                ? fpsSample <= 25
                                  ? 'low'
                                  : fpsSample <= 45
                                    ? 'medium'
                                    : 'high'
                                : null;

                    }

                    playerState.pingMs = Math.round(pingMs);

                    playerState.pingReportedAt = Date.now();

                    playerState.fpsSample = fpsSample;

                    playerState.perfTier = perfTier;

                    roomState.players.set(socket.id, playerState);

                } catch (e) {

                    console.error(`[tenant:${tenant.id}] report-ping:`, e);

                }

            });



            socket.on('set-username', (data) => {

                try {

                    const name = String(data?.username ?? data ?? '').trim();

                    if (name.length < 1 || name.length > 32) return;

                    playerState.username = name;
                    if (socket.data.clientSessionId) {
                        playerState.clientSessionId = socket.data.clientSessionId;
                    }

                    roomState.players.set(socket.id, playerState);

                    evictSupersededPlayerSessions(io, tenant.id, socket, {
                        clientSessionId: socket.data.clientSessionId,
                        username: name,
                    });

                    io.to(roomId).emit('player-username-updated', {

                        id: socket.id,

                        username: name,

                        displayName: name,

                    });

                    emitPlayersUpdate(io, socket.data.currentRoom || roomId, roomState);

                } catch (e) {

                    console.error(`[tenant:${tenant.id}] set-username:`, e);

                    socket.emit('error', { message: 'set_username_failed' });

                }

            });



            socket.on('player-update', (data) => {

                try {

                    const currentRoom = socket.data.currentRoom || roomId;

                    const state = getTenantRoomState(tenant.id, currentRoom);

                    const player = state.players.get(socket.id);

                    if (!player) return;



                    const incomingTimestamp = data?.timestamp || Date.now();

                    if (incomingTimestamp <= (player.timestamp || 0)) return;



                    if (data?.position) {

                        const pos = data.position;

                        if ([pos.x, pos.y, pos.z].every((n) => typeof n === 'number' && Number.isFinite(n))) {

                            player.position = { x: pos.x, y: pos.y, z: pos.z };

                        }

                    }

                    if (data?.rotation) player.rotation = data.rotation;

                    if (data?.quaternion) player.quaternion = data.quaternion;

                    if (data?.animState !== undefined) {

                        player.animState = normalizePlayerAnimState(data.animState);

                    }

                    if (data?.adminInvisible !== undefined && socket.data.isAdmin) {
                        player.adminInvisible = !!data.adminInvisible;
                    }



                    const targetWorld = data?.world;

                    if (targetWorld && targetWorld !== currentRoom && isValidRoomForTenant(tenant, targetWorld)) {

                        movePlayerToRoom(io, tenant, socket, player, currentRoom, targetWorld);

                        return;

                    }



                    player.timestamp = incomingTimestamp;

                    player.world = currentRoom;

                    state.players.set(socket.id, player);

                } catch (e) {

                    console.error(`[tenant:${tenant.id}] player-update:`, e);

                    socket.emit('error', { message: 'player_update_failed' });

                }

            });



            socket.on('change-world', (data, callback) => {

                try {

                    const oldRoom = socket.data.currentRoom || roomId;

                    const newRoom = String(data?.world || DEFAULT_ROOM).trim() || DEFAULT_ROOM;



                    if (oldRoom === newRoom) {

                        if (typeof callback === 'function') callback({ ok: true });

                        return;

                    }



                    if (!isValidRoomForTenant(tenant, newRoom)) {

                        const err = { error: 'invalid_world', message: '存在しないワールドです。' };

                        if (typeof callback === 'function') callback(err);

                        else socket.emit('change-world-rejected', err);

                        return;

                    }



                    const state = getTenantRoomState(tenant.id, oldRoom);

                    const player = state.players.get(socket.id);

                    if (!player) return;



                    movePlayerToRoom(io, tenant, socket, player, oldRoom, newRoom);

                    void handleTenantMediaRoomChange(socket, io, tenant.id, newRoom);

                    if (typeof callback === 'function') callback({ ok: true, world: newRoom });

                } catch (e) {

                    console.error(`[tenant:${tenant.id}] change-world:`, e);

                    if (typeof callback === 'function') {

                        callback({ error: 'change_world_failed', message: 'ワールド切替に失敗しました。' });

                    }

                }

            });



            socket.on('admin-kick-player', (data, callback) => {
                if (!socket.data.isAdmin) return;
                const targetSocketId = data?.targetSocketId;
                const targetSocket = typeof targetSocketId === 'string'
                    ? io.sockets.sockets.get(targetSocketId)
                    : undefined;
                const error = resolveAdminKickPlayerRequest(
                    socket,
                    targetSocketId,
                    targetSocket,
                    tenant.id,
                );
                if (error) {
                    console.warn(`[tenant:${tenant.id}] admin-kick rejected: ${error}`);
                    replyAdminKickPlayer(socket, buildAdminKickRejectionPayload(error), callback);
                    return;
                }
                applyAdminKickToSocket(targetSocket);
                replyAdminKickPlayer(socket, { ok: true }, callback);
                console.log(`[tenant:${tenant.id}] admin kicked player ${targetSocketId}`);
            });



            socket.on('disconnect', () => {

                try {

                    void cleanupTenantMediaOnDisconnect(socket, io, tenant.id);

                    const rid = socket.data.currentRoom || roomId;

                    const state = getTenantRoomState(tenant.id, rid);

                    state.players.delete(socket.id);

                    socket.to(rid).emit('player-left', socket.id);

                    emitPlayersUpdate(io, rid, state);

                } catch (e) {

                    console.error(`[tenant:${tenant.id}] disconnect:`, e);

                }

            });

        } catch (e) {

            console.error(`[tenant:${tenant.id}] connection error:`, e);

            try {

                socket.emit('error', { message: 'connection_failed' });

                socket.disconnect(true);

            } catch {

                /* ignore */

            }

        }

    });

}



/**

 * tenant ごとの players-update ティック

 * @param {import('socket.io').Server} io

 * @param {string} tenantId

 */

function startTenantPlayersUpdateTick(io, tenantId) {

    if (tenantTickTimers.has(tenantId)) {

        clearInterval(tenantTickTimers.get(tenantId));

    }

    const timer = setInterval(() => {

        const byTenant = tenantRoomStates.get(tenantId);

        if (!byTenant) return;

        for (const [roomId, roomState] of byTenant.entries()) {

            reconcileRoomPlayers(io, tenantId, roomId, roomState);

            if (roomState.players.size === 0) continue;

            emitPlayersUpdate(io, roomId, roomState);

        }

    }, PLAYERS_UPDATE_INTERVAL_MS);

    tenantTickTimers.set(tenantId, timer);

}



/**
 * Socket.io CORS オプションを構築する
 * @param {{ corsOrigins?: string[] }} options
 */
function buildSocketCors(options = {}) {
    return options.corsOrigins?.length
        ? { origin: options.corsOrigins, credentials: true }
        : { origin: true, credentials: true };
}



/**
 * 単一 tenant 用 Socket.io Server を httpServer に attach する
 * @param {import('http').Server} httpServer
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {{ corsOrigins?: string[] }} options
 */
export function registerTenantSocketServer(httpServer, tenant, options = {}) {
    if (tenantIoServers.has(tenant.id)) {
        unregisterTenantSocketServer(tenant.id);
    }

    const cors = buildSocketCors(options);
    const socketPath = `/${tenant.id}/socket.io`;
    const io = new Server(httpServer, {
        path: socketPath,
        cors,
    });

    attachTenantSocketHandlers(io, tenant);
    startTenantPlayersUpdateTick(io, tenant.id);
    tenantIoServers.set(tenant.id, io);
    console.log(`[tenant-socket] registered path ${socketPath}`);
}



/**
 * tenant の Socket.io を解除し接続・状態をクリアする
 * @param {string} tenantId
 */
export function unregisterTenantSocketServer(tenantId) {
    const id = String(tenantId || '').trim();
    const io = tenantIoServers.get(id);
    if (io) {
        disposeTenantSocketServer(io);
        tenantIoServers.delete(id);
    }

    const timer = tenantTickTimers.get(id);
    if (timer) {
        clearInterval(timer);
        tenantTickTimers.delete(id);
    }

    tenantRoomStates.delete(id);
    console.log(`[tenant-socket] unregistered tenant: ${id}`);
}



/**
 * 登録 tenant ごとに Socket.io Server を httpServer に attach

 * @param {import('http').Server} httpServer

 * @param {import('./tenant-registry.js').TenantRecord[]} tenants

 * @param {{ corsOrigins?: string[] }} options

 */

export function registerTenantSocketServers(httpServer, tenants, options = {}) {

    for (const [tenantId, io] of tenantIoServers) {

        disposeTenantSocketServer(io);

        tenantIoServers.delete(tenantId);

    }

    for (const timer of tenantTickTimers.values()) {

        clearInterval(timer);

    }

    tenantTickTimers.clear();

    tenantRoomStates.clear();



    for (const tenant of tenants) {

        registerTenantSocketServer(httpServer, tenant, options);

    }

}



/**

 * tenant の接続プレイヤー数（検証用）

 * @param {string} tenantId

 * @returns {number}

 */

export function getTenantPlayerCount(tenantId) {

    const byTenant = tenantRoomStates.get(tenantId);

    if (!byTenant) return 0;

    let total = 0;

    for (const room of byTenant.values()) {

        total += room.players.size;

    }

    return total;

}



/**

 * 全 tenant の Socket 統計

 * @returns {Array<{ tenantId: string, players: number, rooms: number }>}

 */

export function getTenantSocketStatsList() {

    const rows = [];

    for (const tenantId of tenantIoServers.keys()) {

        const byTenant = tenantRoomStates.get(tenantId);

        let players = 0;

        let rooms = 0;

        if (byTenant) {

            for (const room of byTenant.values()) {

                rooms += 1;

                players += room.players.size;

            }

        }

        rows.push({ tenantId, players, rooms });

    }

    return rows;

}



/**

 * 登録済み Socket.io tenant ID 一覧

 * @returns {string[]}

 */

export function listRegisteredTenantSocketIds() {

    return [...tenantIoServers.keys()];

}



/**

 * プラットフォーム全体の Socket 集計

 * @returns {{ totalPlayers: number, totalRooms: number, tenantCount: number }}

 */

export function getPlatformSocketTotals() {

    let totalPlayers = 0;

    let totalRooms = 0;

    for (const byTenant of tenantRoomStates.values()) {

        for (const room of byTenant.values()) {

            totalRooms += 1;

            totalPlayers += room.players.size;

        }

    }

    return {

        totalPlayers,

        totalRooms,

        tenantCount: tenantIoServers.size,

    };

}

