// lib/admin-metaverse-token.js — 管理画面メタバース入場ワンタイムトークン

import crypto from 'node:crypto';

/** @type {Map<string, { expiry: number, mode: 'default' | 'camera', username?: string, clientIp: string }>} */
const adminTokens = new Map();

export const ADMIN_TOKEN_TTL_MS = 5 * 60 * 1000;

/**
 * 管理トークンの IP 拘束（双方非空かつ一致時のみ許可）
 * @param {unknown} boundIp
 * @param {unknown} requestIp
 * @returns {boolean}
 */
export function adminTokenClientIpMatches(boundIp, requestIp) {
    const bound = String(boundIp || '').trim();
    const request = String(requestIp || '').trim();
    if (!bound || !request) return false;
    return bound === request;
}

/** Socket 入場用（HttpOnly、JS から読めない） */
export const ADMIN_METAVERSE_TOKEN_COOKIE = 'metaverseAdminToken';

/**
 * @param {string} token
 * @param {{ secure?: boolean }} [options]
 * @returns {string}
 */
export function buildAdminMetaverseTokenSetCookie(token, options = {}) {
    const maxAgeSec = Math.max(1, Math.floor(ADMIN_TOKEN_TTL_MS / 1000));
    const parts = [
        `${ADMIN_METAVERSE_TOKEN_COOKIE}=${encodeURIComponent(token)}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        `Max-Age=${maxAgeSec}`,
    ];
    if (options.secure) {
        parts.push('Secure');
    }
    return parts.join('; ');
}

/**
 * @param {{ secure?: boolean }} [options]
 * @returns {string}
 */
export function buildAdminMetaverseTokenClearCookie(options = {}) {
    const parts = [
        `${ADMIN_METAVERSE_TOKEN_COOKIE}=`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        'Max-Age=0',
    ];
    if (options.secure) {
        parts.push('Secure');
    }
    return parts.join('; ');
}

/**
 * @param {unknown} cookieHeader
 * @returns {string | null}
 */
export function readAdminTokenFromCookieHeader(cookieHeader) {
    if (typeof cookieHeader !== 'string' || !cookieHeader.trim()) return null;
    const prefix = `${ADMIN_METAVERSE_TOKEN_COOKIE}=`;
    for (const segment of cookieHeader.split(';')) {
        const trimmed = segment.trim();
        if (!trimmed.startsWith(prefix)) continue;
        const raw = trimmed.slice(prefix.length);
        if (!raw) return null;
        try {
            return decodeURIComponent(raw);
        } catch {
            return raw;
        }
    }
    return null;
}

/**
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isSecureAdminCookieRequest(req) {
    if (req.secure) return true;
    const proto = req.headers['x-forwarded-proto'];
    if (typeof proto === 'string') {
        return proto.split(',')[0].trim().toLowerCase() === 'https';
    }
    return false;
}

/** カメラログイン等でユーザーに見せない仮名 */
function allocateStealthGuestUsername() {
    const n = Math.floor(Math.random() * 10000);
    return `Guest${String(n).padStart(4, '0')}`;
}

/**
 * @param {'default'|'camera'} [mode]
 * @param {string} [clientIp]
 * @returns {{ token: string, username?: string }}
 */
export function generateAdminToken(mode = 'default', clientIp = '') {
    const token = crypto.randomBytes(32).toString('hex');
    /** @type {{ expiry: number, mode: 'default' | 'camera', username?: string, clientIp: string }} */
    const entry = {
        expiry: Date.now() + ADMIN_TOKEN_TTL_MS,
        mode,
        clientIp: String(clientIp || '').trim(),
    };
    if (mode === 'camera') {
        entry.username = allocateStealthGuestUsername();
    }
    adminTokens.set(token, entry);
    return mode === 'camera'
        ? { token, username: entry.username }
        : { token };
}

/**
 * @param {unknown} token
 * @param {string} [clientIp]
 * @returns {{ mode: 'default' | 'camera', username?: string } | null}
 */
export function consumeAdminToken(token, clientIp = '') {
    if (!token || typeof token !== 'string') return null;
    const entry = adminTokens.get(token);
    if (!entry || Date.now() >= entry.expiry) {
        if (entry) adminTokens.delete(token);
        return null;
    }
    if (!adminTokenClientIpMatches(entry.clientIp, clientIp)) {
        adminTokens.delete(token);
        return null;
    }
    adminTokens.delete(token);
    return {
        mode: entry.mode === 'camera' ? 'camera' : 'default',
        username: entry.username,
    };
}

/**
 * 管理ワンタイムトークンが未消費かつ有効期限内か（io.use 用、消費はしない）
 * @param {unknown} token
 * @param {string} [clientIp]
 * @returns {boolean}
 */
export function peekAdminToken(token, clientIp = '') {
    if (!token || typeof token !== 'string') return false;
    const entry = adminTokens.get(token);
    if (!entry || Date.now() >= entry.expiry) return false;
    if (!adminTokenClientIpMatches(entry.clientIp, clientIp)) return false;
    return true;
}
