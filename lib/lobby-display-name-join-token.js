// lib/lobby-display-name-join-token.js — 共有参加用の短期表示名トークン（URL に生名を載せない）

import crypto from 'node:crypto';

export const LOBBY_DISPLAY_JOIN_TOKEN_PREFIX = 'lgdn1';
export const LOBBY_DISPLAY_JOIN_TOKEN_TTL_MS = 15 * 60 * 1000;

/**
 * @returns {string}
 */
function resolveDisplayJoinSecret() {
    return String(
        process.env.LOBBY_DISPLAY_JOIN_SECRET || process.env.SOCKET_AUTH_SECRET || '',
    ).trim();
}

/**
 * @param {number} expMs
 * @param {string} nameB64
 * @param {string} secret
 * @returns {string}
 */
function signDisplayJoinPayload(expMs, nameB64, secret) {
    return crypto.createHmac('sha256', secret).update(`${expMs}.${nameB64}`).digest('base64url');
}

/**
 * @param {string} displayName
 * @param {{ ttlMs?: number }} [options]
 * @returns {string | null}
 */
export function mintLobbyDisplayNameJoinToken(displayName, options = {}) {
    const secret = resolveDisplayJoinSecret();
    if (!secret) return null;
    const name = String(displayName || '').trim();
    if (!name || name.length > 64) return null;
    if (!/^[\p{L}\p{N}_\- ]+$/u.test(name)) return null;
    const nameB64 = Buffer.from(name, 'utf8').toString('base64url');
    const ttlMs = Math.max(60_000, Number(options.ttlMs) || LOBBY_DISPLAY_JOIN_TOKEN_TTL_MS);
    const expMs = Date.now() + ttlMs;
    const sig = signDisplayJoinPayload(expMs, nameB64, secret);
    return `${LOBBY_DISPLAY_JOIN_TOKEN_PREFIX}.${expMs}.${nameB64}.${sig}`;
}

/**
 * @param {string} token
 * @returns {{ ok: true, displayName: string } | { ok: false, code: string }}
 */
export function verifyLobbyDisplayNameJoinToken(token) {
    const secret = resolveDisplayJoinSecret();
    if (!secret) return { ok: false, code: 'secret_not_configured' };
    const raw = String(token || '').trim();
    const parts = raw.split('.');
    if (parts.length !== 4 || parts[0] !== LOBBY_DISPLAY_JOIN_TOKEN_PREFIX) {
        return { ok: false, code: 'invalid_token' };
    }
    const expMs = Number(parts[1]);
    if (!Number.isFinite(expMs) || expMs < Date.now()) {
        return { ok: false, code: 'expired' };
    }
    const nameB64 = parts[2];
    const providedSig = parts[3];
    const expected = signDisplayJoinPayload(expMs, nameB64, secret);
    const expBuf = Buffer.from(expected, 'utf8');
    const gotBuf = Buffer.from(providedSig, 'utf8');
    if (expBuf.length !== gotBuf.length || !crypto.timingSafeEqual(expBuf, gotBuf)) {
        return { ok: false, code: 'invalid_token' };
    }
    let displayName;
    try {
        displayName = Buffer.from(nameB64, 'base64url').toString('utf8').trim();
    } catch {
        return { ok: false, code: 'invalid_token' };
    }
    if (!displayName || displayName.length > 64) return { ok: false, code: 'invalid_token' };
    if (!/^[\p{L}\p{N}_\- ]+$/u.test(displayName)) return { ok: false, code: 'invalid_token' };
    return { ok: true, displayName };
}