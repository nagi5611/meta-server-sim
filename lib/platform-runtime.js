// lib/platform-runtime.js — 起動後の動的 tenant Socket 登録用ランタイム参照
/** @type {import('http').Server | null} */
let httpServerRef = null;

/** @type {string[]} */
let socketCorsOrigins = [];

/**
 * プラットフォームランタイムを初期化する
 * @param {import('http').Server} httpServer
 * @param {{ corsOrigins?: string[] }} options
 */
export function initPlatformRuntime(httpServer, options = {}) {
    httpServerRef = httpServer;
    socketCorsOrigins = Array.isArray(options.corsOrigins)
        ? options.corsOrigins.filter(Boolean)
        : [];
}

/**
 * @returns {import('http').Server | null}
 */
export function getPlatformHttpServer() {
    return httpServerRef;
}

/**
 * @returns {{ corsOrigins: string[] }}
 */
export function getPlatformSocketOptions() {
    return { corsOrigins: [...socketCorsOrigins] };
}
