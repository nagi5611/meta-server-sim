// lib/tenant-socket-auth.js — テナント Socket 接続用の任意 join シークレット

import crypto from 'node:crypto';

import { getClientIpFromSocket } from './client-ip.js';
import { peekAdminToken } from './admin-metaverse-token.js';

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
 * テナントに要求する Socket join シークレット（未設定なら空 = 制限なし）
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @returns {string}
 */
export function getEffectiveTenantSocketSecret(tenant) {
    const perTenant = String(tenant?.socketSecret ?? '').trim();
    if (perTenant) return perTenant;
    return String(process.env.TENANT_SOCKET_SECRET ?? '').trim();
}

/**
 * クライアントが handshake.auth で送った join トークンを取得
 * @param {import('socket.io').Handshake} handshake
 * @returns {string}
 */
export function getSocketJoinTokenFromHandshake(handshake) {
    const auth = handshake?.auth;
    if (!auth || typeof auth !== 'object') return '';
    const raw = auth.socketSecret ?? auth.joinToken;
    return String(raw ?? '').trim();
}

/**
 * Socket 接続が join シークレット要件を満たすか（未設定時は常に true）
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {import('socket.io').Handshake} handshake
 * @returns {boolean}
 */
/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {import('socket.io').Handshake} handshake
 * @param {string} [clientIp]
 * @returns {boolean}
 */
export function isTenantSocketJoinAuthorized(tenant, handshake, clientIp = '') {
    const required = getEffectiveTenantSocketSecret(tenant);
    if (!required) return true;

    const ip = clientIp || '';
    const adminToken = handshake?.auth?.adminToken;
    if (peekAdminToken(adminToken, ip)) return true;

    const provided = getSocketJoinTokenFromHandshake(handshake);
    if (!provided) return false;
    return timingSafeEqualStr(provided, required);
}

/**
 * io.use 用: 未許可なら Error を返す
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {import('socket.io').Socket} socket
 * @param {(err?: Error) => void} next
 */
export function assertTenantSocketJoinAuthorized(tenant, socket, next) {
    const clientIp = getClientIpFromSocket(socket);
    if (isTenantSocketJoinAuthorized(tenant, socket.handshake, clientIp)) {
        next();
        return;
    }
    next(new Error('socket_join_forbidden'));
}
