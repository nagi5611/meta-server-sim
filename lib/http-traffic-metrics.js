// lib/http-traffic-metrics.js — HTTP 送信トラフィック集計（管理パネル用）

import { Transform } from 'node:stream';

const WINDOW_MS = 60_000;
const MAX_TOP_PATHS = 15;
const startedAt = Date.now();

/** @type {Map<string, { total: number, byCategory: Map<string, number>, paths: Map<string, number> }>} */
const tenantBuckets = new Map();

/** @type {Array<{ t: number, tenantId: string, category: string, bytes: number }>} */
const recentEvents = [];

/**
 * @param {string} tenantId
 */
function ensureTenantBucket(tenantId) {
    const id = tenantId || '_platform';
    if (!tenantBuckets.has(id)) {
        tenantBuckets.set(id, {
            total: 0,
            byCategory: new Map(),
            paths: new Map(),
        });
    }
    return tenantBuckets.get(id);
}

/**
 * 子プロセスからの IPC メッセージを取り込む
 * @param {unknown} msg
 */
export function ingestHttpTrafficIpcMessage(msg) {
    if (!msg || typeof msg !== 'object' || msg.type !== 'http-traffic') {
        return;
    }
    const tenantId = String(msg.tenantId || '').trim();
    const category = String(msg.category || 'unknown');
    const bytes = Number(msg.bytes);
    if (!tenantId || !Number.isFinite(bytes) || bytes <= 0) {
        return;
    }
    recordHttpTraffic(tenantId, category, bytes, {
        path: typeof msg.path === 'string' ? msg.path : undefined,
    });
}

/**
 * 送信バイトを記録する
 * @param {string} tenantId
 * @param {string} category
 * @param {number} bytes
 * @param {{ path?: string }} [detail]
 */
export function recordHttpTraffic(tenantId, category, bytes, detail = {}) {
    const n = Math.floor(Number(bytes));
    if (!tenantId || !Number.isFinite(n) || n <= 0) {
        return;
    }

    if (process.env.FDS_SMOKE_BULK_CHILD === '1' && typeof process.send === 'function') {
        process.send({
            type: 'http-traffic',
            tenantId,
            category,
            bytes: n,
            path: detail.path,
        });
        return;
    }

    const bucket = ensureTenantBucket(tenantId);
    bucket.total += n;
    bucket.byCategory.set(category, (bucket.byCategory.get(category) || 0) + n);

    if (detail.path) {
        const key = `${category}:${detail.path}`;
        bucket.paths.set(key, (bucket.paths.get(key) || 0) + n);
    }

    const now = Date.now();
    recentEvents.push({ t: now, tenantId, category, bytes: n });
    pruneRecentEvents(now);
}

/**
 * @param {number} now
 */
function pruneRecentEvents(now) {
    const cutoff = now - WINDOW_MS;
    while (recentEvents.length > 0 && recentEvents[0].t < cutoff) {
        recentEvents.shift();
    }
    if (recentEvents.length > 20_000) {
        recentEvents.splice(0, recentEvents.length - 20_000);
    }
}

/**
 * @param {number} [now]
 * @returns {number}
 */
export function getPlatformBytesLastWindow(now = Date.now()) {
    const cutoff = now - WINDOW_MS;
    let sum = 0;
    for (const ev of recentEvents) {
        if (ev.t >= cutoff) {
            sum += ev.bytes;
        }
    }
    return sum;
}

/**
 * @param {string} tenantId
 * @param {number} [now]
 * @returns {number}
 */
function getTenantBytesLastWindow(tenantId, now = Date.now()) {
    const cutoff = now - WINDOW_MS;
    let sum = 0;
    for (const ev of recentEvents) {
        if (ev.tenantId === tenantId && ev.t >= cutoff) {
            sum += ev.bytes;
        }
    }
    return sum;
}

/**
 * @param {Map<string, number>} paths
 * @returns {Array<{ key: string, bytes: number }>}
 */
function topPaths(paths) {
    return [...paths.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, MAX_TOP_PATHS)
        .map(([key, bytes]) => ({ key, bytes }));
}

/**
 * @param {import('./tenant-registry.js').TenantRecord | null} [tenant]
 * @returns {object}
 */
export function getHttpTrafficSnapshot(tenant = null) {
    const now = Date.now();
    const windowSec = WINDOW_MS / 1000;

    if (tenant) {
        const bucket = tenantBuckets.get(tenant.id) || {
            total: 0,
            byCategory: new Map(),
            paths: new Map(),
        };
        const lastWindow = getTenantBytesLastWindow(tenant.id, now);
        const byCategory = {};
        for (const [cat, bytes] of bucket.byCategory.entries()) {
            byCategory[cat] = bytes;
        }
        return {
            tenantId: tenant.id,
            startedAt,
            windowSeconds: windowSec,
            bytesSentTotal: bucket.total,
            bytesSentLastWindow: lastWindow,
            bytesPerSecond: lastWindow / windowSec,
            byCategory,
            topPaths: topPaths(bucket.paths),
        };
    }

    let platformTotal = 0;
    const platformByCategory = new Map();
    for (const [tenantId, bucket] of tenantBuckets.entries()) {
        platformTotal += bucket.total;
        for (const [cat, bytes] of bucket.byCategory.entries()) {
            platformByCategory.set(cat, (platformByCategory.get(cat) || 0) + bytes);
        }
    }

    const lastWindow = getPlatformBytesLastWindow(now);
    const byCategory = {};
    for (const [cat, bytes] of platformByCategory.entries()) {
        byCategory[cat] = bytes;
    }

    const tenants = {};
    for (const [tenantId, bucket] of tenantBuckets.entries()) {
        const tLast = getTenantBytesLastWindow(tenantId, now);
        const tCats = {};
        for (const [cat, bytes] of bucket.byCategory.entries()) {
            tCats[cat] = bytes;
        }
        tenants[tenantId] = {
            bytesSentTotal: bucket.total,
            bytesSentLastWindow: tLast,
            bytesPerSecond: tLast / windowSec,
            byCategory: tCats,
        };
    }

    return {
        startedAt,
        windowSeconds: windowSec,
        bytesSentTotal: platformTotal,
        bytesSentLastWindow: lastWindow,
        bytesPerSecond: lastWindow / windowSec,
        byCategory,
        tenants,
    };
}

/**
 * ストリーム経由の送信バイトを数える Transform
 * @returns {{ stream: Transform, getBytesSent: () => number }}
 */
export function createByteCountTransform() {
    let bytesSent = 0;
    const stream = new Transform({
        transform(chunk, _encoding, callback) {
            bytesSent += chunk.length;
            callback(null, chunk);
        },
    });
    return {
        stream,
        getBytesSent: () => bytesSent,
    };
}

/**
 * テスト用に状態をリセットする
 */
export function resetHttpTrafficMetricsForTests() {
    tenantBuckets.clear();
    recentEvents.length = 0;
}
