// lib/http-rate-limit.js — HTTP / Socket.io ハンドシェイク向けレート制限
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { getClientIpFromRequest, getClientIpFromSocket } from './client-ip.js';

const ONE_MINUTE_MS = 60_000;

/**
 * テスト・特殊環境で HTTP レート制限を無効化する
 * @returns {boolean}
 */
export function isHttpRateLimitDisabled() {
    const v = String(process.env.HTTP_RATE_LIMIT_DISABLE ?? '').trim().toLowerCase();
    return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Express リクエストからクライアント IP を解決する
 * @param {import('express').Request} req
 * @returns {string}
 */
export function resolveClientIp(req) {
    const ip = getClientIpFromRequest(req);
    return ip ? ipKeyGenerator(ip) : 'unknown';
}

/**
 * @param {import('express-rate-limit').Options} options
 * @returns {import('express').RequestHandler}
 */
function createExpressRateLimit(options) {
    return rateLimit({
        standardHeaders: 'draft-8',
        legacyHeaders: false,
        message: { error: 'rate_limit_exceeded' },
        skip: () => isHttpRateLimitDisabled(),
        keyGenerator: (req) => resolveClientIp(req),
        ...options,
    });
}

/** 管理画面 Basic 認証まわり（/admin, admin.html 系） */
export function createAdminRouteRateLimit() {
    return createExpressRateLimit({
        windowMs: ONE_MINUTE_MS,
        limit: 120,
        message: { error: 'admin_rate_limit_exceeded' },
    });
}

/** プラットフォーム公開 API（/api/tenants, /api/client-config 等） */
export function createPublicPlatformApiRateLimit() {
    return createExpressRateLimit({
        windowMs: ONE_MINUTE_MS,
        limit: 240,
        message: { error: 'api_rate_limit_exceeded' },
    });
}

/** テナント公開 API（/:tenantId/api/*） */
export function createTenantPublicApiRateLimit() {
    return createExpressRateLimit({
        windowMs: ONE_MINUTE_MS,
        limit: 240,
        message: { error: 'tenant_api_rate_limit_exceeded' },
        keyGenerator: (req) => {
            const tenantId = String(req.tenant?.id || req.params?.tenantId || '').trim() || 'unknown';
            return `${tenantId}:${resolveClientIp(req)}`;
        },
    });
}

/**
 * 固定ウィンドウカウンタ（Socket.io ハンドシェイク等）
 * @param {{ windowMs: number, max: number }} opts
 */
export function createFixedWindowCounter(opts) {
    const windowMs = Math.max(1, opts.windowMs);
    const max = Math.max(1, opts.max);
    /** @type {Map<string, { count: number, resetAt: number }>} */
    const buckets = new Map();

    /**
     * @param {string} key
     * @returns {boolean} 許可なら true
     */
    function tryConsume(key) {
        const now = Date.now();
        let bucket = buckets.get(key);
        if (!bucket || now >= bucket.resetAt) {
            bucket = { count: 0, resetAt: now + windowMs };
            buckets.set(key, bucket);
        }
        bucket.count += 1;
        return bucket.count <= max;
    }

    function resetForTests() {
        buckets.clear();
    }

    return { tryConsume, resetForTests };
}

const socketHandshakeCounter = createFixedWindowCounter({
    windowMs: ONE_MINUTE_MS,
    max: 30,
});

/**
 * Socket.io ハンドシェイク IP を解決する
 * @param {import('socket.io').Socket} socket
 * @returns {string}
 */
export function resolveSocketClientIp(socket) {
    const ip = getClientIpFromSocket(socket);
    return ip ? ipKeyGenerator(ip) : 'unknown';
}

/**
 * テナント Socket.io 接続のレート制限ミドルウェア
 * @param {string} tenantId
 * @returns {import('socket.io').ExtendedError | void}
 */
export function tenantSocketHandshakeRateLimitMiddleware(tenantId) {
    return (socket, next) => {
        if (isHttpRateLimitDisabled()) return next();
        const id = String(tenantId || '').trim() || 'unknown';
        const key = `${id}:${resolveSocketClientIp(socket)}`;
        if (!socketHandshakeCounter.tryConsume(key)) {
            return next(new Error('handshake_rate_limited'));
        }
        return next();
    };
}

/** @internal ユニットテスト用 */
export function resetSocketHandshakeRateLimitForTests() {
    socketHandshakeCounter.resetForTests();
}
