// e2e/helpers/tenant-socket.mjs — Node からテナント Socket.io に接続
import { io } from 'socket.io-client';
import { TENANT_ID } from './tenant-metaverse.mjs';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:3003';

/**
 * テナント Socket に接続して ready を待つ
 * @param {{ adminToken?: string }} [opts]
 */
export function connectTenantSocket(opts = {}) {
    const joinToken =
        opts.joinToken ||
        process.env.E2E_TENANT_SOCKET_JOIN ||
        process.env.TENANT_SOCKET_SECRET ||
        '';
    /** @type {Record<string, string>} */
    const auth = {};
    if (opts.adminToken) auth.adminToken = opts.adminToken;
    if (joinToken) auth.joinToken = joinToken;
    const socket = io(BASE_URL, {
        path: `/${TENANT_ID}/socket.io`,
        transports: ['websocket'],
        auth,
    });

    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.disconnect();
            reject(new Error('tenant socket connect timeout'));
        }, 20_000);

        socket.on('connect', () => {
            clearTimeout(timer);
            resolve(socket);
        });
        socket.on('connect_error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

/**
 * ack 付き emit
 * @param {import('socket.io-client').Socket} socket
 * @param {string} event
 * @param {unknown} data
 */
export function emitAck(socket, event, data = {}) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`ack timeout: ${event}`)), 20_000);
        socket.emit(event, data, (response) => {
            clearTimeout(timer);
            resolve(response);
        });
    });
}

/**
 * 接続を閉じる
 * @param {import('socket.io-client').Socket} socket
 */
export function disconnectSocket(socket) {
    if (socket?.connected) {
        socket.disconnect();
    }
}
