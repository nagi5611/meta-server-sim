// lib/fds-smoke-bulk-process.js — FDS 煙大容量配信の子プロセス管理

import { fork } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformEnv } from './platform-env-config.js';
import { toBrowserPublicUrl } from './platform-network-config.js';
import { ingestHttpTrafficIpcMessage } from './http-traffic-metrics.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CHILD_ENTRY = path.join(__dirname, 'fds-smoke-bulk-child.js');

/** dev: Vite 既定 3003 と bulk の PORT+1 が衝突するため別ポートへ */
const DEV_BULK_FALLBACK_PORT = 3012;

/** @type {ChildProcess | null} */
let bulkChild = null;
/** @type {number | null} */
let bulkPort = null;

/**
 * バルク配信を無効化するか
 * @returns {boolean}
 */
export function isFdsSmokeBulkDisabled() {
    const raw = String(getPlatformEnv('FDS_SMOKE_BULK_DISABLE') || '').trim().toLowerCase();
    return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

/**
 * バルク HTTP ポートを解決する（0 は無効）
 * @param {number} mainPort
 * @returns {number}
 */
export function resolveFdsSmokeBulkPort(mainPort) {
    if (isFdsSmokeBulkDisabled()) {
        return 0;
    }
    const raw = String(getPlatformEnv('FDS_SMOKE_BULK_PORT') || '').trim();
    if (raw === '0') {
        return 0;
    }
    if (raw) {
        const parsed = parseInt(raw, 10);
        if (Number.isFinite(parsed) && parsed > 0) {
            return parsed;
        }
    }
    const candidate = mainPort + 1;
    if (process.env.NODE_ENV === 'production') {
        return candidate;
    }
    const vitePort = parseInt(String(process.env.VITE_DEV_PORT || '3003'), 10) || 3003;
    if (candidate === vitePort) {
        return DEV_BULK_FALLBACK_PORT;
    }
    return candidate;
}

/**
 * Vite dev フロント（X-Forwarded-Host）か
 * @param {string} hostHeader
 * @returns {boolean}
 */
function isViteDevFrontHost(hostHeader) {
    if (process.env.NODE_ENV === 'production') {
        return false;
    }
    const vitePort = parseInt(String(process.env.VITE_DEV_PORT || '3003'), 10) || 3003;
    const match = String(hostHeader || '').match(/:(\d+)$/);
    return match ? parseInt(match[1], 10) === vitePort : false;
}

/**
 * client-config 用の公開オリジン
 * @param {import('express').Request} req
 * @param {number} port
 * @returns {string | null}
 */
export function resolveFdsSmokeBulkPublicOrigin(req, port) {
    if (!port) {
        return null;
    }

    const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
    const proto = forwardedProto || (req.secure ? 'https' : 'http');
    const hostHeader = req.get('x-forwarded-host')?.split(',')[0]?.trim() || req.get('host') || '';

    // HTTPS Vite 上では bulk を同一オリジンにし、Vite が bulk 子へプロキシする（mixed content 回避）
    if (isViteDevFrontHost(hostHeader)) {
        return `${proto}://${hostHeader}`.replace(/\/+$/, '');
    }

    const override = String(getPlatformEnv('FDS_SMOKE_BULK_PUBLIC_ORIGIN') || '').trim();
    if (override) {
        return toBrowserPublicUrl(override.replace(/\/+$/, ''));
    }

    const hostName = hostHeader.split(':')[0] || 'localhost';
    const direct = `${proto}://${hostName}:${port}`;
    return toBrowserPublicUrl(direct);
}

/**
 * 子プロセスでバルク配信サーバーを起動する
 * @param {{ host: string, mainPort: number }} options
 * @returns {Promise<number | null>} 起動したポート（無効時 null）
 */
export async function startFdsSmokeBulkServer(options) {
    const port = resolveFdsSmokeBulkPort(options.mainPort);
    if (!port) {
        return null;
    }
    if (bulkChild) {
        return bulkPort;
    }

    bulkChild = fork(CHILD_ENTRY, [], {
        env: {
            ...process.env,
            FDS_SMOKE_BULK_CHILD: '1',
            FDS_SMOKE_BULK_PORT: String(port),
            HOST: options.host,
        },
        stdio: 'inherit',
    });

    bulkPort = port;

    bulkChild.on('message', (msg) => {
        ingestHttpTrafficIpcMessage(msg);
    });

    bulkChild.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
            console.warn(`[fds-smoke-bulk] child exited (code=${code}, signal=${signal})`);
        }
        bulkChild = null;
        bulkPort = null;
    });

    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            reject(new Error('fds-smoke-bulk child start timeout'));
        }, 15_000);

        bulkChild?.once('message', (msg) => {
            if (msg?.type === 'fds-smoke-bulk-ready') {
                clearTimeout(timer);
                resolve(undefined);
            }
        });

        bulkChild?.once('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });

    console.log(`[fds-smoke-bulk] listening on port ${port}`);
    return port;
}

/**
 * 起動済みバルクポート
 * @returns {number | null}
 */
export function getFdsSmokeBulkPort() {
    return bulkPort;
}

/**
 * 子プロセスを停止する
 */
export function stopFdsSmokeBulkServer() {
    if (!bulkChild) {
        return;
    }
    bulkChild.kill('SIGTERM');
    bulkChild = null;
    bulkPort = null;
}
