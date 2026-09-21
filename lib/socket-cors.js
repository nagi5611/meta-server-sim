// lib/socket-cors.js — Socket.io CORS オプション（origin:true を使わない）
import { getDefaultDevSocketCorsOrigins } from './platform-network-config.js';

/**
 * Socket.io CORS オプションを構築する
 * @param {{ corsOrigins?: string[] }} options
 */
export function buildSocketIoCorsOptions(options = {}) {
    const listed = (options.corsOrigins ?? []).filter(Boolean);
    if (listed.length > 0) {
        return { origin: listed, credentials: true };
    }
    if (process.env.NODE_ENV === 'production') {
        return { origin: false, credentials: true };
    }
    return { origin: getDefaultDevSocketCorsOrigins(), credentials: true };
}
