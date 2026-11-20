// public/js/tenant-plugin-client-loader.js — fetch enabled plugins and load game modules
import { getTenantIdFromPath } from './tenant-runtime-shim.js';
import * as clientAddonRegistry from '../../../metaverse-simple/lib/client-addon-registry.js';

function ensureTenantPluginClientBridge() {
    if (globalThis.__tenantPluginClientBridge) return;
    globalThis.__tenantPluginClientBridge = clientAddonRegistry;
}

/**
 * Dynamic import された addon クライアントが bare `three` を解決できるようにする
 * @param {string} tenantId
 * @param {string} pluginId
 */
function ensurePluginClientImportMap(tenantId, pluginId) {
    if (pluginId !== 'xr' && pluginId !== 'vdb-volume') return;
    const mapId = pluginId === 'xr' ? 'tenant-xr-three-importmap' : 'tenant-vdb-volume-three-importmap';
    if (document.getElementById(mapId)) return;
    const imports =
        pluginId === 'xr'
            ? (() => {
                  const base = `/${encodeURIComponent(tenantId)}/api/tenant-plugins/xr/deps`;
                  return {
                      three: `${base}/three/build/three.module.js`,
                      'three/addons/': `${base}/three/examples/jsm/`,
                      'three/examples/jsm/': `${base}/three/examples/jsm/`,
                  };
              })()
            : (() => {
                  const base = `/${encodeURIComponent(tenantId)}/addons-client/vdb-volume/deps`;
                  return {
                      three: `${base}/three/build/three.module.js`,
                      'three/addons/': `${base}/three/examples/jsm/`,
                      'three/examples/jsm/': `${base}/three/examples/jsm/`,
                  };
              })();
    const script = document.createElement('script');
    script.type = 'importmap';
    script.id = mapId;
    script.textContent = JSON.stringify({ imports });
    document.head.prepend(script);
}

/**
 * @param {string} tenantId
 */
async function fetchEnabledPlugins(tenantId) {
    const primary = `/${encodeURIComponent(tenantId)}/api/tenants/${encodeURIComponent(tenantId)}/addons/enabled`;
    let res = await fetch(primary, { credentials: 'include' });
    if (!res.ok) {
        res = await fetch(`/${encodeURIComponent(tenantId)}/api/addons/enabled`, {
            credentials: 'include',
        });
    }
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    if (Array.isArray(data.plugins)) return data.plugins;
    return [];
}

/**
 * Load enabled tenant plugin client modules (game).
 */
export async function loadTenantPluginClientModules() {
    const tenantId = getTenantIdFromPath();
    if (!tenantId) return;

    ensureTenantPluginClientBridge();

    const plugins = await fetchEnabledPlugins(tenantId);
    for (const plugin of plugins) {
        const rel = plugin?.gameModule;
        if (!rel || typeof rel !== 'string') continue;
        const url = `/${encodeURIComponent(tenantId)}/addons-client/${encodeURIComponent(plugin.id)}/${rel}`;
        try {
            ensurePluginClientImportMap(tenantId, plugin.id);
            const mod = await import(/* @vite-ignore */ url);
            if (typeof mod.initTenantPlugin === 'function') {
                await mod.initTenantPlugin();
            }
        } catch (e) {
            console.warn('[tenant-plugins] client load failed', plugin.id, e);
        }
    }
}
