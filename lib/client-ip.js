// lib/client-ip.js — 信頼プロキシ時のみ X-Forwarded-For をクライアント IP に使う

import { resolveServerBootConfig } from './platform-network-config.js';

/** @type {boolean | null} */
let trustForwardedFor = null;

/**
 * server.js の `app.set('trust proxy')` と同条件（USE_REVERSE_PROXY かつ TRUST_PROXY）
 * @returns {boolean}
 */
export function shouldTrustForwardedClientIp() {
    if (trustForwardedFor === null) {
        const boot = resolveServerBootConfig();
        trustForwardedFor = Boolean(boot.useReverseProxy && boot.trustProxy);
    }
    return trustForwardedFor;
}

/** @internal テスト用 */
export function resetTrustForwardedClientIpCacheForTests() {
    trustForwardedFor = null;
}

/**
 * @param {unknown} raw
 * @returns {string}
 */
function normalizeIp(raw) {
    const s = String(raw || '').trim();
    if (s.startsWith('::ffff:')) return s.slice(7);
    return s;
}

/**
 * @param {unknown} forwarded
 * @returns {string}
 */
function firstForwardedFor(forwarded) {
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim();
    }
    if (Array.isArray(forwarded) && forwarded.length) {
        const first = String(forwarded[0] || '').trim();
        if (first) return first.split(',')[0].trim();
    }
    return '';
}

/**
 * @param {import('express').Request} req
 * @returns {string}
 */
export function getClientIpFromRequest(req) {
    if (shouldTrustForwardedClientIp()) {
        const ip = req.ip || firstForwardedFor(req.headers['x-forwarded-for']);
        if (ip) return normalizeIp(ip);
    }
    return normalizeIp(req.socket?.remoteAddress);
}

/**
 * @param {import('socket.io').Socket} socket
 * @returns {string}
 */
export function getClientIpFromSocket(socket) {
    if (shouldTrustForwardedClientIp()) {
        const fromHeader = firstForwardedFor(socket.handshake?.headers?.['x-forwarded-for']);
        if (fromHeader) return normalizeIp(fromHeader);
    }
    const addr = socket.handshake?.address;
    return normalizeIp(typeof addr === 'string' ? addr : '');
}
