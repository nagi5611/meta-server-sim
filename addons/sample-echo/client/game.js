// addons/sample-echo/client/game.js — loaded dynamically by tenant-plugin-client-loader.js
/** @type {((detail: { id: string }) => void) | null} */
let frameHook = null;

export async function initTenantPlugin() {
    if (typeof window === 'undefined') return;
    window.__tenantSampleEchoLoaded = true;
    console.info('[sample-echo] tenant game module loaded');
}

export function registerGameFrameHook(fn) {
    frameHook = fn;
}

export function runGameFrameHook(detail) {
    frameHook?.(detail);
}
