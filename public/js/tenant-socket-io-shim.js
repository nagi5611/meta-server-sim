// public/js/tenant-socket-io-shim.js — Socket.io をテナント path で接続（再帰エイリアス回避）
import { io as originalIo } from 'socket.io-client-original';
import { getInMemoryAdminMetaverseToken } from './tenant-admin-metaverse-auth.js';
import { getTenantBase } from './tenant-runtime-shim.js';

const CLIENT_SESSION_STORAGE_KEY = 'metaverseClientSessionId';
const SOCKET_JOIN_STORAGE_KEY = 'metaverseSocketJoinToken';

/**
 * URL ?join= / ?socketSecret= を sessionStorage に保存し auth 用トークンを返す
 * @returns {string | null}
 */
function getSocketJoinTokenFromUrlOrStorage() {
    try {
        const params = new URLSearchParams(window.location.search);
        const fromUrl = params.get('join') || params.get('socketSecret');
        if (fromUrl) {
            sessionStorage.setItem(SOCKET_JOIN_STORAGE_KEY, fromUrl);
            return fromUrl;
        }
        return sessionStorage.getItem(SOCKET_JOIN_STORAGE_KEY);
    } catch {
        return null;
    }
}

/**
 * 再接続時にサーバーが旧ソケットを掃除するための永続 ID
 * @returns {string | null}
 */
function getOrCreateClientSessionId() {
    try {
        let id = localStorage.getItem(CLIENT_SESSION_STORAGE_KEY);
        if (!id) {
            id = globalThis.crypto?.randomUUID?.() ?? `cs_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
            localStorage.setItem(CLIENT_SESSION_STORAGE_KEY, id);
        }
        return id;
    } catch {
        return null;
    }
}

/**
 * テナント向け Socket.io 接続
 * @param {string} [url]
 * @param {import('socket.io-client').ManagerOptions & import('socket.io-client').SocketOptions} [options]
 */
export function io(url, options = {}) {
    const tenantBase = getTenantBase();
    const socketPath = tenantBase ? `${tenantBase}/socket.io` : '/socket.io';
    /** @type {Record<string, unknown>} */
    let auth = { ...(options.auth || {}) };
    // join 制限時の補助。主経路は handshake 付属の HttpOnly Cookie（peek はサーバー側）
    const inMemoryAdminToken = getInMemoryAdminMetaverseToken();
    if (inMemoryAdminToken && !auth.adminToken) {
        auth.adminToken = inMemoryAdminToken;
    }
    const clientSessionId = getOrCreateClientSessionId();
    if (clientSessionId && !auth.clientSessionId) {
        auth.clientSessionId = clientSessionId;
    }
    const joinToken = getSocketJoinTokenFromUrlOrStorage();
    if (joinToken && !auth.joinToken && !auth.socketSecret) {
        auth.joinToken = joinToken;
    }
    try {
        const tenantBase = getTenantBase();
        const tenantId = tenantBase ? tenantBase.replace(/^\//, '') : '';
        if (tenantId) {
            const stored = localStorage.getItem(`metaverseAvatarId:${tenantId}`);
            if (stored && !auth.avatarId) auth.avatarId = stored;
        }
    } catch {
        /* ignore */
    }
    return originalIo(url ?? window.location.origin, {
        ...options,
        withCredentials: options.withCredentials ?? true,
        path: socketPath,
        auth,
    });
}

export { io as default };
