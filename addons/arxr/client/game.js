// addons/arxr/client/game.js — expose AR entry URL to tenant metaverse shell

function getTenantIdFromBrowserPath() {
    const parts = String(window.location.pathname || '')
        .split('/')
        .filter(Boolean);
    if (!parts.length) return null;
    const first = parts[0];
    if (first === 'admin' || first === 'api') return null;
    return first;
}

export async function initTenantPlugin() {
    const tenantId = getTenantIdFromBrowserPath();
    if (!tenantId) return;
    const base = `/${encodeURIComponent(tenantId)}/api/tenant-plugins/arxr/`;
    globalThis.__tenantArxrEntryUrl = base;
    globalThis.__tenantArxrPluginLoaded = true;
    console.info('[addon:arxr] entry URL', base);
}
