// addons/vdb-volume/client/game.js — NanoVDB / OpenVDB ボリューム描画
import { registerClientInit } from './metaverse-registry-shim.js';
import { VdbVolumeManager } from './vdb-volume-manager.js';

export async function initTenantPlugin() {
    globalThis.__tenantVdbVolumePluginLoaded = true;
}

/**
 * @returns {Promise<object | null>}
 */
async function fetchPluginConfig() {
    const parts = String(globalThis.location?.pathname || '')
        .split('/')
        .filter(Boolean);
    const tenantId = parts[0];
    if (!tenantId || tenantId === 'admin' || tenantId === 'api') return null;
    const url = `/${encodeURIComponent(tenantId)}/api/tenant-plugins/vdb-volume/health`;
    try {
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) return null;
        return await res.json();
    } catch {
        return null;
    }
}

registerClientInit(async (app) => {
    const pluginConfig = {
        defaultGridName: 'density',
        raySteps: 96,
        densityScale: 0.08,
    };
    await fetchPluginConfig();
    const manager = new VdbVolumeManager(app, pluginConfig);
    const scene = app?.sceneManager?.getScene?.();
    if (scene) manager.attachScene(scene);
    manager.hookWorldChanges();
    app._vdbVolumeManager = manager;
    globalThis.__tenantVdbVolumeManager = manager;
});

console.info('[addon:vdb-volume] client registered');