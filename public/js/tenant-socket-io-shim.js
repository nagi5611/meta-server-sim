// public/js/tenant-socket-io-shim.js — Socket.io をテナント path で接続（再帰エイリアス回避）
import { io as originalIo } from 'socket.io-client-original';
import { getTenantBase } from './tenant-runtime-shim.js';

/**
 * テナント向け Socket.io 接続
 * @param {string} [url]
 * @param {import('socket.io-client').ManagerOptions & import('socket.io-client').SocketOptions} [options]
 */
export function io(url, options = {}) {
    const tenantBase = getTenantBase();
    const socketPath = tenantBase ? `${tenantBase}/socket.io` : '/socket.io';
    return originalIo(url ?? window.location.origin, {
        ...options,
        path: socketPath,
    });
}

export { io as default };
