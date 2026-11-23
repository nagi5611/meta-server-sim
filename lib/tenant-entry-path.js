// lib/tenant-entry-path.js — ブラウザ URL からテナント ID を解決（import map bootstrap 等）

/**
 * @param {string} pathname
 * @returns {string}
 */
export function parseTenantIdFromPathname(pathname) {
    const reserved = new Set(['api', 'admin', 'css', 'js', 'dist', 'node_modules']);
    const parts = String(pathname || '').split('/').filter(Boolean);
    const tenantId = parts[0] ? decodeURIComponent(parts[0]) : '';
    if (!tenantId || reserved.has(tenantId.toLowerCase())) return '';
    return tenantId;
}