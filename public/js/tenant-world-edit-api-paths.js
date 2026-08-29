// public/js/tenant-world-edit-api-paths.js — ワールド編集ページの API URL を Tenant 管理向けに書き換え

/**
 * /admin/tenant/:id/world-edit 上で /admin/* /api/client-config を Tenant API へ向ける
 * @param {string} urlStr
 * @returns {string}
 */
export function rewriteTenantWorldEditApiUrl(urlStr) {
    const raw = String(urlStr || '');
    const pathName = window.location.pathname;
    const adminMatch = pathName.match(/\/admin\/tenant\/([^/]+)/);
    if (!adminMatch?.[1]) return raw;

    const tenantId = decodeURIComponent(adminMatch[1]);
    const adminBase = `/admin/tenants/${encodeURIComponent(tenantId)}`;

    if (raw === '/api/client-config' || raw.startsWith('/api/client-config?')) {
        return `${adminBase}/client-config${raw.slice('/api/client-config'.length)}`;
    }

    if (raw.startsWith('/admin/tenants/')) return raw;
    if (raw === '/admin/csrf-token' || raw.startsWith('/admin/csrf-token?')) return raw;
    if (raw.startsWith('/admin/')) {
        return `${adminBase}${raw.slice('/admin'.length)}`;
    }

    return raw;
}
