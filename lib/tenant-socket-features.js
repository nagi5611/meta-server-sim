// lib/tenant-socket-features.js — テナント Socket のメニュー関連機能（VC / チャット / 字幕 / 管理者）

import {
    consumeAdminToken,
    readAdminTokenFromCookieHeader,
} from './admin-metaverse-token.js';
import { getClientIpFromSocket } from './client-ip.js';
import { createTenantVcState } from './tenant-vc-server.js';
import { createTenantVideoVcState } from './tenant-video-vc-server.js';
import { registerTenantChatSocketHandlers } from './tenant-chat-socket.js';
import { registerTenantVcSocketHandlers } from './tenant-vc-server.js';
import { registerTenantVideoVcSocketHandlers } from './tenant-video-vc-server.js';
import {
    captionsCleanupSocket,
    captionsCloseSession,
    captionsNotifySpeaker,
    captionsRuntimeReady,
    ensureTenantCaptionsConfigured,
    registerTenantCaptionsSocketHandlers,
} from './tenant-captions-socket.js';
import { initTenantMediasoupWorkers } from './tenant-mediasoup-core.js';
import { isCaptionsRuntimeReady } from '../../metaverse-simple/lib/captions-config.js';

/** @type {Map<string, ReturnType<typeof createTenantVcState>>} */
const tenantVcStates = new Map();

/** @type {Map<string, ReturnType<typeof createTenantVideoVcState>>} */
const tenantVideoVcStates = new Map();

let mediasoupInitPromise = null;

/**
 * mediasoup ワーカーを起動（1回のみ）
 */
export function ensureTenantMediasoupWorkers() {
    if (!mediasoupInitPromise) {
        mediasoupInitPromise = initTenantMediasoupWorkers().catch((err) => {
            mediasoupInitPromise = null;
            throw err;
        });
    }
    return mediasoupInitPromise;
}

/**
 * @param {object} player
 * @returns {string}
 */
export function getPlayerDisplayName(player) {
    if (player?.isAdmin === true) return 'admin';
    return String(player?.username || 'Guest').trim() || 'Guest';
}

/**
 * @param {string} tenantId
 * @returns {ReturnType<typeof createTenantVcState>}
 */
function getTenantVcState(tenantId) {
    if (!tenantVcStates.has(tenantId)) {
        tenantVcStates.set(tenantId, createTenantVcState(tenantId));
    }
    return tenantVcStates.get(tenantId);
}

/**
 * @param {string} tenantId
 * @returns {ReturnType<typeof createTenantVideoVcState>}
 */
function getTenantVideoVcState(tenantId) {
    if (!tenantVideoVcStates.has(tenantId)) {
        tenantVideoVcStates.set(tenantId, createTenantVideoVcState(tenantId));
    }
    return tenantVideoVcStates.get(tenantId);
}

/**
 * 接続時の管理者トークン検証
 * @param {import('socket.io').Socket} socket
 */
export function applyAdminTokenToSocket(socket) {
    const fromAuth = socket.handshake.auth?.adminToken;
    const fromCookie = readAdminTokenFromCookieHeader(socket.handshake.headers.cookie);
    const adminToken = fromAuth || fromCookie;
    const clientIp = getClientIpFromSocket(socket);
    const adminAuth = consumeAdminToken(adminToken, clientIp);
    if (adminAuth) {
        socket.data.isAdmin = true;
        socket.data.adminCameraMode = adminAuth.mode === 'camera';
        socket.data.role = 'admin';
        console.log(`[tenant-socket] admin connected: ${socket.id}`);
    } else {
        socket.data.isAdmin = false;
    }
}

/**
 * メニュー関連 Socket ハンドラを登録
 * @param {import('socket.io').Socket} socket
 * @param {import('socket.io').Server} io
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {{
 *   getRoomState: (tenantId: string, worldId: string) => { players: Map<string, object> },
 *   isValidWorld: (worldId: string) => boolean,
 * }} helpers
 */
export function registerTenantMenuSocketHandlers(socket, io, tenant, helpers) {
    const tenantId = tenant.id;
    const vcState = getTenantVcState(tenantId);
    const videoVcState = getTenantVideoVcState(tenantId);

    void ensureTenantCaptionsConfigured((worldId) => helpers.getRoomState(tenantId, worldId));

    const socketDeps = {
        getWorldRoomId: (s) => s.data.currentRoom,
        isValidWorld: helpers.isValidWorld,
        getCaptionDeps: () => ({
            captionsRuntimeReady: () => isCaptionsRuntimeReady(),
            captionsNotifySpeaker: (ioSrv, _vcRoomId, socketId) => {
                const worldId = socket.data.currentRoom;
                if (worldId) {
                    void captionsNotifySpeaker(ioSrv, worldId, socketId);
                }
            },
            captionsCloseSession: (socketId) => {
                void captionsCloseSession(socketId);
            },
        }),
    };

    registerTenantChatSocketHandlers(socket, io, tenant, {
        getRoomState: helpers.getRoomState,
        getPlayerDisplayName,
    });
    registerTenantVcSocketHandlers(socket, io, tenant, vcState, socketDeps);
    registerTenantVideoVcSocketHandlers(socket, io, tenant, videoVcState, socketDeps);
    registerTenantCaptionsSocketHandlers(socket, io, (s) => {
        const worldId = s.data.currentRoom;
        if (!worldId) return 'Guest';
        const roomState = helpers.getRoomState(tenantId, worldId);
        const player = roomState.players.get(s.id);
        return player ? getPlayerDisplayName(player) : 'Guest';
    });

    return { vcState, videoVcState };
}

/**
 * ワールド変更時に VC / 字幕 / ビデオ VC を同期
 * @param {import('socket.io').Socket} socket
 * @param {import('socket.io').Server} io
 * @param {string} tenantId
 * @param {string} newWorldId
 */
export async function handleTenantMediaRoomChange(socket, io, tenantId, newWorldId) {
    const vcState = getTenantVcState(tenantId);
    const videoVcState = getTenantVideoVcState(tenantId);
    await vcState.cleanupVCPeer(socket.id, io);
    vcState.emitVcRoomChanged(socket, newWorldId);
    await captionsCleanupSocket(io, socket);
    await videoVcState.cleanupVideoVCPeer(socket.id, io);
    videoVcState.emitVideoVcRoomChanged(socket, newWorldId);
}

/**
 * 切断時のメディアリソース解放
 * @param {import('socket.io').Socket} socket
 * @param {import('socket.io').Server} io
 * @param {string} tenantId
 */
export async function cleanupTenantMediaOnDisconnect(socket, io, tenantId) {
    const vcState = getTenantVcState(tenantId);
    const videoVcState = getTenantVideoVcState(tenantId);
    await vcState.cleanupVCPeer(socket.id, io);
    await videoVcState.cleanupVideoVCPeer(socket.id, io);
    await captionsCleanupSocket(io, socket);
}
