// lib/tenant-captions-socket.js — テナント向けリアルタイム字幕 Socket.io ハンドラ

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/** @type {Promise<typeof import('../../metaverse-simple/lib/captions-server.js')> | null} */
let captionsModulePromise = null;

/**
 * metaverse-simple の storage-paths が要求する META_SRC_DIRECTORY を満たす
 */
function ensureMetaverseSimpleStorageEnv() {
    if (process.env.META_SRC_DIRECTORY) return;
    const bridgeRoot = path.join(PROJECT_ROOT, 'data', 'platform', 'metaverse-simple-bridge');
    const dataDir = path.join(bridgeRoot, 'data');
    for (const dir of [
        bridgeRoot,
        dataDir,
        path.join(bridgeRoot, 'models'),
        path.join(bridgeRoot, 'pdfs'),
        path.join(bridgeRoot, 'images'),
        path.join(bridgeRoot, 'env'),
        path.join(bridgeRoot, 'db'),
        path.join(bridgeRoot, 'logs'),
    ]) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
    if (!fs.existsSync(path.join(dataDir, 'worlds.json'))) {
        fs.writeFileSync(path.join(dataDir, 'worlds.json'), '{}\n', 'utf8');
    }
    if (!fs.existsSync(path.join(dataDir, 'charts.json'))) {
        fs.writeFileSync(path.join(dataDir, 'charts.json'), '{}\n', 'utf8');
    }
    process.env.META_SRC_DIRECTORY = bridgeRoot;
}

/**
 * @returns {Promise<typeof import('../../metaverse-simple/lib/captions-server.js') | null>}
 */
async function loadCaptionsModule() {
    if (!captionsModulePromise) {
        captionsModulePromise = (async () => {
            try {
                ensureMetaverseSimpleStorageEnv();
                const mod = await import('../../metaverse-simple/lib/captions-server.js');
                const { initCaptionsLogDb } = await import(
                    '../../metaverse-simple/db/captions-log.js'
                );
                try {
                    initCaptionsLogDb();
                } catch (e) {
                    console.warn('[captions] initCaptionsLogDb skipped:', e?.message || e);
                }
                return mod;
            } catch (e) {
                console.warn('[captions] module load failed:', e?.message || e);
                return null;
            }
        })();
    }
    return captionsModulePromise;
}

let captionsConfigured = false;

/**
 * @param {(worldId: string) => { players: Map<string, object> } | null} getRoomStateForWorld
 */
export async function ensureTenantCaptionsConfigured(getRoomStateForWorld) {
    const mod = await loadCaptionsModule();
    if (!mod || captionsConfigured) return;
    mod.configureCaptionsServer({
        getRoomState: (worldId) => getRoomStateForWorld(worldId),
    });
    captionsConfigured = true;
}

/**
 * @param {import('socket.io').Socket} socket
 * @param {import('socket.io').Server} io
 * @param {(socket: import('socket.io').Socket) => string} getDisplayName
 */
export function registerTenantCaptionsSocketHandlers(socket, io, getDisplayName) {
    socket.on('stt-listen', async ({ enabled } = {}) => {
        const mod = await loadCaptionsModule();
        if (!mod?.captionsReady()) return;
        const roomId = socket.data.currentRoom;
        if (!roomId) return;
        mod.setListener(io, roomId, socket.id, !!enabled);
    });

    socket.on('stt-audio-chunk', async (chunk) => {
        const mod = await loadCaptionsModule();
        if (!mod?.captionsReady()) return;
        mod.handleAudioChunk(io, socket, chunk, () => getDisplayName(socket)).catch((e) => {
            console.error('[captions] handleAudioChunk error:', e?.message || e);
        });
    });
}

/**
 * @param {import('socket.io').Server} io
 * @param {import('socket.io').Socket} socket
 */
export async function captionsCleanupSocket(io, socket) {
    const mod = await loadCaptionsModule();
    if (!mod) return;
    mod.cleanupSocket(io, socket);
}

/**
 * @param {string} socketId
 */
export async function captionsCloseSession(socketId) {
    const mod = await loadCaptionsModule();
    if (!mod) return;
    mod.closeSession(socketId);
}

/**
 * @param {import('socket.io').Server} io
 * @param {string} worldRoomId
 * @param {string} socketId
 */
export async function captionsNotifySpeaker(io, worldRoomId, socketId) {
    const mod = await loadCaptionsModule();
    if (!mod) return;
    mod.notifySpeakerIfListeners(io, worldRoomId, socketId);
}

/**
 * @returns {Promise<boolean>}
 */
export async function captionsRuntimeReady() {
    const mod = await loadCaptionsModule();
    return !!mod?.captionsReady();
}
