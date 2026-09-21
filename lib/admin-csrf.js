// lib/admin-csrf.js — 管理 API 向け CSRF トークン（短 TTL + セッション結合 + double-submit cookie）
import crypto from 'node:crypto';
import { isSecureAdminCookieRequest } from './admin-metaverse-token.js';

export const ADMIN_CSRF_HEADER = 'X-Admin-CSRF';

/** double-submit: ヘッダと一致必須（HttpOnly） */
export const ADMIN_CSRF_COOKIE = 'adminCsrf';

/** トークン HMAC に結合するブラウザセッション ID（HttpOnly） */
export const ADMIN_CSRF_SESSION_COOKIE = 'adminCsrfSid';

const TOKEN_TTL_MS = 15 * 60 * 1000;
const SESSION_COOKIE_MAX_AGE_SEC = 8 * 60 * 60;

/**
 * @param {unknown} cookieHeader
 * @returns {string|null}
 */
export function readAdminCsrfCookieFromHeader(cookieHeader) {
    return readNamedCookie(cookieHeader, ADMIN_CSRF_COOKIE);
}

/**
 * @param {unknown} cookieHeader
 * @returns {string|null}
 */
export function readAdminCsrfSessionFromHeader(cookieHeader) {
    return readNamedCookie(cookieHeader, ADMIN_CSRF_SESSION_COOKIE);
}

/**
 * @param {unknown} cookieHeader
 * @param {string} name
 * @returns {string|null}
 */
function readNamedCookie(cookieHeader, name) {
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
 * @param {string} name
 * @param {string} value
 * @param {number} maxAgeSec
 * @param {import('express').Request} req
 * @returns {string}
 */
function buildSetCookie(name, value, maxAgeSec, req) {
    const parts = [
        `${name}=${encodeURIComponent(value)}`,
        'HttpOnly',
        'SameSite=Lax',
        'Path=/',
        `Max-Age=${Math.max(1, Math.floor(maxAgeSec))}`,
    ];
    if (isSecureAdminCookieRequest(req)) {
        parts.push('Secure');
    }
    return parts.join('; ');
}

/**
 * @param {string} adminPassword
 * @param {{ nowMs?: () => number }} [options]
 */
export function createAdminCsrfBundle(adminPassword, options = {}) {
    const secret = String(adminPassword || '');
    const nowMs = typeof options.nowMs === 'function' ? options.nowMs : () => Date.now();

    /**
     * @param {string} sessionId
     * @returns {{ token: string, expiresAt: number }}
     */
    function issueToken(sessionId) {
        const sid = String(sessionId || '');
        if (!sid) {
            throw new Error('admin CSRF session id required');
        }
        const issuedAt = nowMs();
        const nonce = crypto.randomBytes(16).toString('hex');
        const payload = `${issuedAt}.${nonce}.${sid}`;
        const sig = crypto.createHmac('sha256', secret).update(payload).digest('hex');
        return {
            token: `${issuedAt}.${nonce}.${sig}`,
            expiresAt: issuedAt + TOKEN_TTL_MS,
        };
    }

    /**
     * @param {unknown} token
     * @param {string} sessionId
     * @returns {boolean}
     */
    function verifyToken(token, sessionId) {
        if (!secret || typeof token !== 'string' || !token) return false;
        const sid = String(sessionId || '');
        if (!sid) return false;
        const parts = token.split('.');
        if (parts.length !== 3) return false;
        const [issuedStr, nonce, sig] = parts;
        const issuedAt = Number(issuedStr);
        if (!Number.isFinite(issuedAt) || !nonce || !sig) return false;
        const now = nowMs();
        if (issuedAt > now + 5_000) return false;
        if (now - issuedAt > TOKEN_TTL_MS) return false;
        const payload = `${issuedAt}.${nonce}.${sid}`;
        const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
        try {
            const a = Buffer.from(sig, 'hex');
            const b = Buffer.from(expected, 'hex');
            if (a.length !== b.length) return false;
            return crypto.timingSafeEqual(a, b);
        } catch {
            return false;
        }
    }

    /**
     * @param {import('express').Request} req
     * @param {import('express').Response} res
     * @returns {string}
     */
    function ensureCsrfSessionId(req, res) {
        let sid = readAdminCsrfSessionFromHeader(req.headers.cookie);
        if (!sid) {
            sid = crypto.randomBytes(16).toString('hex');
            res.append(
                'Set-Cookie',
                buildSetCookie(ADMIN_CSRF_SESSION_COOKIE, sid, SESSION_COOKIE_MAX_AGE_SEC, req)
            );
        }
        return sid;
    }

    /**
     * @param {import('express').Request} req
     * @param {import('express').Response} res
     * @param {import('express').NextFunction} next
     */
    function adminCsrfProtection(req, res, next) {
        const method = String(req.method || 'GET').toUpperCase();
        if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
            return next();
        }
        const raw = req.headers[ADMIN_CSRF_HEADER.toLowerCase()] ?? req.headers[ADMIN_CSRF_HEADER];
        const headerToken = typeof raw === 'string' ? raw : '';
        const cookieToken = readAdminCsrfCookieFromHeader(req.headers.cookie) || '';
        const sessionId = readAdminCsrfSessionFromHeader(req.headers.cookie) || '';
        if (
            !headerToken ||
            !cookieToken ||
            !sessionId ||
            !timingSafeEqualStr(headerToken, cookieToken) ||
            !verifyToken(headerToken, sessionId)
        ) {
            return res.status(403).json({ error: 'csrf_invalid' });
        }
        return next();
    }

    /**
     * @param {import('express').Express} app
     */
    function registerAdminCsrfRoute(app) {
        app.get('/admin/csrf-token', (req, res) => {
            const sessionId = ensureCsrfSessionId(req, res);
            const issued = issueToken(sessionId);
            const maxAgeSec = Math.max(1, Math.ceil((issued.expiresAt - nowMs()) / 1000));
            res.append(
                'Set-Cookie',
                buildSetCookie(ADMIN_CSRF_COOKIE, issued.token, maxAgeSec, req)
            );
            res.json({ ok: true, token: issued.token, expiresAt: issued.expiresAt });
        });
    }

    return { adminCsrfProtection, registerAdminCsrfRoute, issueToken, verifyToken, ensureCsrfSessionId };
}
