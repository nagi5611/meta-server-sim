// lib/tenant-metaverse-http-auth.js — テナントメタバース HTTP（署名 URL 等）のセッション認証

import crypto from 'node:crypto';
import {
    SOCKET_AUTH_TOKEN_MAX_AGE_MS,
    signSocketAuthToken,
    verifySocketAuthToken,
} from '../../metaverse-simple/lib/socket-auth-token.js';
import { resolveAdminCredentials } from './admin-auth.js';
import {
    peekAdminToken,
    readAdminTokenFromCookieHeader,
} from './admin-metaverse-token.js';
import { getClientIpFromRequest } from './client-ip.js';

/** metaverse-simple と同一（Socket / 署名 URL 用 httpOnly Cookie） */
export const TENANT_SOCKET_AUTH_COOKIE = 'metaverse_socket_auth';

/** バルク子などクロスオリジン fetch 用（Cookie が送れない場合） */
export const TENANT_SOCKET_AUTH_QUERY = 'mvsauth';

/**
 * @param {string} a
 * @param {string} b
 * @returns {boolean}
 */
function timingSafeEqualStr(a, b) {
    const bufa = Buffer.from(String(a), 'utf8');
    const bufb = Buffer.from(String(b), 'utf8');
    if (bufa.length !== bufb.length) return false;
    return crypto.timingSafeEqual(bufa, bufb);
}

/**
 * @returns {boolean}
 */
function isAuthCookieSecure() {
    const isNodeProduction = process.env.NODE_ENV === 'production';
    return isNodeProduction && process.env.COOKIE_SECURE !== '0';
}

/**
 * @param {unknown} cookieHeader
 * @param {string} name
 * @returns {string | null}
 */
export function readCookieFromHeader(cookieHeader, name) {
    if (typeof cookieHeader !== 'string' || !cookieHeader.trim()) return null;
    const prefix = `${name}=`;
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
 * @returns {string | null}
 */
export function getSocketAuthTokenFromHttp(req) {
    const fromCookie = readCookieFromHeader(req.headers.cookie, TENANT_SOCKET_AUTH_COOKIE);
    if (fromCookie) return fromCookie;
    const q = req.query?.[TENANT_SOCKET_AUTH_QUERY];
    if (typeof q === 'string' && q.trim()) {
        return q.trim();
    }
    return null;
}

/**
 * client-config 等: ゲスト用 HTTP/Socket 認証トークンを返す（Cookie も設定）
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {string | null}
 */
export function ensureGuestHttpAuthForClientConfig(req, res) {
    const existing = getSocketAuthTokenFromHttp(req);
    if (verifySocketAuthToken(existing)) {
        return existing;
    }
    try {
        const token = signSocketAuthToken({ role: 'guest' });
        setSocketAuthCookieOnResponse(res, token);
        return token;
    } catch (err) {
        console.error('[tenant client-config] guest http auth:', err);
        return null;
    }
}

/**
 * @param {import('express').Response} res
 * @param {string} token
 */
export function setSocketAuthCookieOnResponse(res, token) {
    const maxAgeSec = Math.max(1, Math.floor(SOCKET_AUTH_TOKEN_MAX_AGE_MS / 1000));
    const parts = [
        `${TENANT_SOCKET_AUTH_COOKIE}=${token}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        `Max-Age=${maxAgeSec}`,
    ];
    if (isAuthCookieSecure()) {
        parts.push('Secure');
    }
    const cookieStr = parts.join('; ');
    const prev = res.getHeader('Set-Cookie');
    if (!prev) {
        res.setHeader('Set-Cookie', cookieStr);
    } else if (Array.isArray(prev)) {
        res.setHeader('Set-Cookie', [...prev, cookieStr]);
    } else {
        res.setHeader('Set-Cookie', [String(prev), cookieStr]);
    }
}

/**
 * client-config 応答時: R2 利用者向けゲスト Socket 認証 Cookie（未設定時のみ）
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export function ensureGuestSocketAuthCookieForClientConfig(req, res) {
    ensureGuestHttpAuthForClientConfig(req, res);
}

/**
 * 管理者 Basic 認証（metaverse-simple の isSocketAuthOrAdminBasic と同等）
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isAdminBasicAuthorized(req) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) return false;
    const { username, password } = resolveAdminCredentials();
    try {
        const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
        const sep = decoded.indexOf(':');
        const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
        const pass = sep >= 0 ? decoded.slice(sep + 1) : '';
        return timingSafeEqualStr(user, username) && timingSafeEqualStr(pass, password);
    } catch {
        return false;
    }
}

/**
 * テナントメタバース向け HTTP が署名 URL 発行等を許可されるか
 * @param {import('express').Request} req
 * @returns {boolean}
 */
export function isTenantMetaverseHttpAuthorized(req) {
    if (verifySocketAuthToken(getSocketAuthTokenFromHttp(req))) return true;

    const clientIp = getClientIpFromRequest(req);
    const adminFromCookie = readAdminTokenFromCookieHeader(req.headers.cookie);
    if (peekAdminToken(adminFromCookie, clientIp)) return true;

    const bodyToken =
        req.body && typeof req.body === 'object' && typeof req.body.adminToken === 'string'
            ? req.body.adminToken.trim()
            : '';
    if (bodyToken && peekAdminToken(bodyToken, clientIp)) return true;

    if (isAdminBasicAuthorized(req)) return true;

    return false;
}
