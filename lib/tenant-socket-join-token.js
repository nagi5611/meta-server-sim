// lib/tenant-socket-join-token.js — ロビー発行の短期・テナントスコープ Socket join トークン

import crypto from 'node:crypto';

import { getEffectiveTenantSocketSecret } from './tenant-socket-auth.js';

export const TENANT_SOCKET_JOIN_TOKEN_TTL_MS = 10 * 60 * 1000;
const TOKEN_PREFIX = 'tsj1';

/**
 * @param {string} tenantId
 * @param {number} expMs
 * @param {string} secret
 * @returns {string}
 */
function signTenantJoinPayload(tenantId, expMs, secret) {
    return crypto.createHmac('sha256', secret).update(`${tenantId}.${expMs}`).digest('base64url');
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {{ ttlMs?: number }} [options]
 * @returns {{ joinToken: string, expiresAt: string } | null}
 */
export function mintTenantSocketJoinToken(tenant, options = {}) {
    const secret = getEffectiveTenantSocketSecret(tenant);
    if (!secret) return null;
    const tenantId = String(tenant?.id || '').trim();
    if (!tenantId) return null;
    const ttlMs = Math.max(60_000, Number(options.ttlMs) || TENANT_SOCKET_JOIN_TOKEN_TTL_MS);
    const expMs = Date.now() + ttlMs;
    const sig = signTenantJoinPayload(tenantId, expMs, secret);
    const joinToken = `${TOKEN_PREFIX}.${tenantId}.${expMs}.${sig}`;
    return { joinToken, expiresAt: new Date(expMs).toISOString() };
}

/**
 * @param {string} token
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @returns {boolean}
 */
export function verifyTenantSocketJoinToken(token, tenant) {
    const secret = getEffectiveTenantSocketSecret(tenant);
    if (!secret) return false;
    const raw = String(token || '').trim();
    const parts = raw.split('.');
    if (parts.length !== 4 || parts[0] !== TOKEN_PREFIX) return false;
    const tokenTenantId = parts[1];
    const tenantId = String(tenant?.id || '').trim();
    if (!tenantId || tokenTenantId !== tenantId) return false;
    const expMs = Number(parts[2]);
    if (!Number.isFinite(expMs) || expMs < Date.now()) return false;
    const expected = signTenantJoinPayload(tenantId, expMs, secret);
    const providedSig = parts[3];
    const expBuf = Buffer.from(expected, 'utf8');
    const gotBuf = Buffer.from(providedSig, 'utf8');
    if (expBuf.length !== gotBuf.length) return false;
    return crypto.timingSafeEqual(expBuf, gotBuf);
}