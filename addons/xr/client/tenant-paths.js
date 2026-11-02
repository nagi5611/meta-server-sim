/**
 * @returns {string|null}
 */
export function getTenantIdFromBrowserPath() {
    const parts = String(window.location.pathname || '')
        .split('/')
        .filter(Boolean);
    if (parts.length === 0) return null;
    const first = parts[0];
    if (first === 'admin' || first === 'api' || first === 'hub') return null;
    return first;
}

/**
 * @returns {string}
 */
export function resolveTenantAddonsEnabledUrl() {
    const tenantId = getTenantIdFromBrowserPath();
    if (tenantId) {
        return `/${encodeURIComponent(tenantId)}/api/addons/enabled`;
    }
    return '/api/addons/enabled';
}
