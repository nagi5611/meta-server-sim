// lib/tenant-mediasoup-core.js — テナント向け mediasoup ワーカー・ルータ・ICE 設定

import os from 'node:os';
import mediasoup from 'mediasoup';
import { getPlatformEnv } from './platform-env-config.js';

const MEDIASOUP_ANNOUNCED_IP = getPlatformEnv('MEDIASOUP_ANNOUNCED_IP') || undefined;
const MEDIASOUP_ANNOUNCED_LAN_IP = String(getPlatformEnv('MEDIASOUP_ANNOUNCED_LAN_IP') || '').trim();
const MEDIASOUP_ENABLE_LOCALHOST =
    getPlatformEnv('MEDIASOUP_ENABLE_LOCALHOST') === '1' ||
    process.env.NODE_ENV !== 'production';

if (process.env.NODE_ENV === 'production' && !MEDIASOUP_ANNOUNCED_IP) {
    console.warn(
        '[VC] NODE_ENV=production but MEDIASOUP_ANNOUNCED_IP is not set. ' +
        'External WebRTC clients may fail to connect. ' +
        'Set MEDIASOUP_ANNOUNCED_IP to your public IP or domain.',
    );
}

/**
 * mediasoup WebRtcTransport の listenIps（0.0.0.0 + 公衆 announced、任意で LAN・localhost）
 * @returns {{ ip: string, announcedIp?: string }[]}
 */
function buildMediasoupListenIps() {
    const listenIps = [
        {
            ip: '0.0.0.0',
            announcedIp: MEDIASOUP_ANNOUNCED_IP || undefined,
        },
    ];
    if (MEDIASOUP_ANNOUNCED_LAN_IP) {
        listenIps.push({
            ip: MEDIASOUP_ANNOUNCED_LAN_IP,
            announcedIp: MEDIASOUP_ANNOUNCED_LAN_IP,
        });
    }
    if (MEDIASOUP_ENABLE_LOCALHOST) {
        listenIps.push({
            ip: '127.0.0.1',
            announcedIp: '127.0.0.1',
        });
    }
    return listenIps;
}

const VC_RTC_MIN_PORT = parseInt(getPlatformEnv('VC_RTC_MIN_PORT') || '10000', 10);
const VC_RTC_MAX_PORT = parseInt(getPlatformEnv('VC_RTC_MAX_PORT') || '10100', 10);
const VIDEO_VC_RTC_MIN_PORT = parseInt(getPlatformEnv('VIDEO_VC_RTC_MIN_PORT') || '30000', 10);
const VIDEO_VC_RTC_MAX_PORT = parseInt(getPlatformEnv('VIDEO_VC_RTC_MAX_PORT') || '31000', 10);

export const VIDEO_VC_MAX_PRODUCERS_PER_ROOM = parseInt(
    getPlatformEnv('VIDEO_VC_MAX_PRODUCERS_PER_ROOM') || '10',
    10,
);

const VC_MAX_MEDIASOUP_ROUTERS = (() => {
    const n = parseInt(getPlatformEnv('VC_MAX_ROUTERS') || '128', 10);
    const v = Number.isFinite(n) && n > 0 ? n : 128;
    return Math.max(4, Math.min(4096, v));
})();

export const mediasoupConfig = {
    worker: {
        rtcMinPort: VC_RTC_MIN_PORT,
        rtcMaxPort: VC_RTC_MAX_PORT,
        logLevel: 'warn',
        logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    },
    router: {
        mediaCodecs: [
            {
                kind: 'audio',
                mimeType: 'audio/opus',
                clockRate: 48000,
                channels: 2,
            },
        ],
    },
    webRtcTransport: {
        listenIps: buildMediasoupListenIps(),
        maxIncomingBitrate: 150000,
        initialAvailableOutgoingBitrate: 600000,
    },
};

export const videoVcMediasoupConfig = {
    worker: {
        rtcMinPort: VIDEO_VC_RTC_MIN_PORT,
        rtcMaxPort: VIDEO_VC_RTC_MAX_PORT,
        logLevel: 'warn',
        logTags: ['info', 'ice', 'dtls', 'rtp', 'srtp', 'rtcp'],
    },
    router: {
        mediaCodecs: [
            { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
            {
                kind: 'video',
                mimeType: 'video/VP8',
                clockRate: 90000,
                rtcpFeedback: [
                    { type: 'nack' },
                    { type: 'nack', parameter: 'pli' },
                    { type: 'ccm', parameter: 'fir' },
                    { type: 'goog-remb' },
                    { type: 'transport-cc' },
                ],
            },
            {
                kind: 'video',
                mimeType: 'video/H264',
                clockRate: 90000,
                parameters: { 'level-asymmetry-allowed': 1 },
                rtcpFeedback: [
                    { type: 'nack' },
                    { type: 'nack', parameter: 'pli' },
                    { type: 'ccm', parameter: 'fir' },
                    { type: 'goog-remb' },
                    { type: 'transport-cc' },
                ],
            },
        ],
    },
    webRtcTransport: {
        ...mediasoupConfig.webRtcTransport,
        maxIncomingBitrate: 5000000,
    },
};

export const MAX_ACTIVE_PRODUCERS_PER_ROOM = 10;

const workers = [];
let nextWorkerIndex = 0;

const videoVcWorkers = [];
let nextVideoVcWorkerIndex = 0;

/** @type {Map<string, import('mediasoup').types.Router>} */
const vcRouters = new Map();

/** @type {Map<string, import('mediasoup').types.Router>} */
const videoVcRouters = new Map();

let cachedIceServers = null;
let iceServersExpiry = 0;

/**
 * @param {string} tenantId
 * @param {string} worldId
 * @returns {string}
 */
export function buildVcRoomId(tenantId, worldId) {
    return `${tenantId}:${worldId}`;
}

/**
 * @param {string} vcRoomId
 * @param {string} tenantId
 * @returns {string | null}
 */
export function parseWorldIdFromVcRoom(vcRoomId, tenantId) {
    const prefix = `${tenantId}:`;
    if (typeof vcRoomId !== 'string' || !vcRoomId.startsWith(prefix)) {
        return null;
    }
    const worldId = vcRoomId.slice(prefix.length);
    return worldId || null;
}

async function fetchCloudflareIceServers() {
    const apiToken = getPlatformEnv('CLOUDFLARE_TURN_API_TOKEN');
    const keyId = getPlatformEnv('CLOUDFLARE_TURN_KEY_ID');

    if (!apiToken || !keyId) {
        console.log('[VC] Cloudflare TURN not configured (missing API_TOKEN or KEY_ID)');
        return null;
    }

    try {
        const response = await fetch(
            `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${apiToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ttl: 86400 }),
            },
        );

        if (!response.ok) {
            throw new Error(`Cloudflare API error: ${response.status}`);
        }

        const data = await response.json();
        console.log('[VC] Cloudflare ICE servers fetched successfully');
        return data.iceServers;
    } catch (error) {
        console.error('[VC] Failed to fetch Cloudflare ICE servers:', error);
        return null;
    }
}

export async function getIceServers() {
    const now = Date.now();

    if (cachedIceServers && now < iceServersExpiry) {
        return cachedIceServers;
    }

    const cloudflareServers = await fetchCloudflareIceServers();

    if (cloudflareServers) {
        cachedIceServers = cloudflareServers;
        iceServersExpiry = now + 23 * 60 * 60 * 1000;
        console.log('[VC] Using Cloudflare ICE servers');
        return cachedIceServers;
    }

    console.log('[VC] Using fallback STUN only');
    return [{ urls: ['stun:stun.l.google.com:19302'] }];
}

async function createAudioWorkers() {
    const numWorkers = Math.min(os.cpus().length, 4);
    console.log(`Creating ${numWorkers} mediasoup workers...`);

    for (let i = 0; i < numWorkers; i++) {
        const worker = await mediasoup.createWorker({
            ...mediasoupConfig.worker,
        });

        worker.on('died', () => {
            console.error(`mediasoup worker ${worker.pid} died, exiting in 2s...`);
            setTimeout(() => process.exit(1), 2000);
        });

        workers.push(worker);
        console.log(`mediasoup worker ${i + 1} created [pid: ${worker.pid}]`);
    }
}

async function createVideoVcWorkers() {
    const numWorkers = Math.min(os.cpus().length, 4);
    console.log(
        `Creating ${numWorkers} Video VC mediasoup workers (ports ${VIDEO_VC_RTC_MIN_PORT}-${VIDEO_VC_RTC_MAX_PORT})...`,
    );
    for (let i = 0; i < numWorkers; i++) {
        const worker = await mediasoup.createWorker({
            ...videoVcMediasoupConfig.worker,
        });
        worker.on('died', () => {
            console.error(`[Video VC] mediasoup worker ${worker.pid} died, exiting in 2s...`);
            setTimeout(() => process.exit(1), 2000);
        });
        videoVcWorkers.push(worker);
        console.log(`[Video VC] worker ${i + 1} created [pid: ${worker.pid}]`);
    }
}

/**
 * 音声 VC とビデオ VC の mediasoup ワーカーを初期化する
 */
export async function initTenantMediasoupWorkers() {
    await createAudioWorkers();
    await createVideoVcWorkers();
}

export function getNextWorker() {
    const worker = workers[nextWorkerIndex];
    nextWorkerIndex = (nextWorkerIndex + 1) % workers.length;
    return worker;
}

export function getNextVideoVcWorker() {
    const w = videoVcWorkers[nextVideoVcWorkerIndex];
    nextVideoVcWorkerIndex = (nextVideoVcWorkerIndex + 1) % videoVcWorkers.length;
    return w;
}

export async function getOrCreateVCRouter(roomId) {
    if (!vcRouters.has(roomId)) {
        if (vcRouters.size >= VC_MAX_MEDIASOUP_ROUTERS) {
            throw new Error('room_limit');
        }
        const worker = getNextWorker();
        const router = await worker.createRouter({
            mediaCodecs: mediasoupConfig.router.mediaCodecs,
        });
        vcRouters.set(roomId, router);
        console.log(`[VC] Created Router for room: ${roomId}`);
    }
    return vcRouters.get(roomId);
}

export async function getOrCreateVideoVCRouter(roomId) {
    if (!videoVcRouters.has(roomId)) {
        if (videoVcRouters.size >= VC_MAX_MEDIASOUP_ROUTERS) {
            throw new Error('room_limit');
        }
        const worker = getNextVideoVcWorker();
        const router = await worker.createRouter({
            mediaCodecs: videoVcMediasoupConfig.router.mediaCodecs,
        });
        videoVcRouters.set(roomId, router);
        console.log(`[Video VC] Created Router for room: ${roomId}`);
    }
    return videoVcRouters.get(roomId);
}
