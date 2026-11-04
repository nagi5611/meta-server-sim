// public/js/tenant-plugin-admin-client-loader.js — enabled plugin admin UI modules
import { adminFetch } from './admin-api-fetch.js';

/**
 * @param {string} tenantId
 */
async function fetchEnabledAdminPlugins(tenantId) {
    const res = await adminFetch(`/admin/tenant/${encodeURIComponent(tenantId)}/plugins`, {
        credentials: 'include',
    });
    if (!res.ok) return [];
    const data = await res.json().catch(() => ({}));
    const plugins = Array.isArray(data.plugins) ? data.plugins : [];
    return plugins.filter((p) => p.enabled && p.adminModule);
}

/**
 * Load enabled tenant plugin admin client modules for admin-tenant.html.
 * @param {string} tenantId
 */
export async function loadTenantPluginAdminClientModules(tenantId) {
    const tid = String(tenantId || '').trim();
    if (!tid) return;

    const plugins = await fetchEnabledAdminPlugins(tid);
    for (const plugin of plugins) {
        const rel = plugin.adminModule;
        if (!rel || typeof rel !== 'string') continue;
        const url = `/${encodeURIComponent(tid)}/addons-client/${encodeURIComponent(plugin.id)}/${rel}`;
        try {
            await import(/* @vite-ignore */ url);
        } catch (e) {
            console.warn('[tenant-plugins] admin client load failed', plugin.id, e);
        }
    }
}
