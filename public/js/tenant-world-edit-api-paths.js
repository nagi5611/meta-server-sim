// public/js/tenant-world-edit-api-paths.js — ワールド編集ページの API URL を Tenant 管理向けに書き換え

/** @type {Set<string>} /admin/tenants/ 直後に来ると tenant ID ではなくリソース名 */
const TENANT_ADMIN_RESOURCE_SEGMENTS = new Set([
    'worlds',
    'models',
    'model-mtls',
    'prefab-manifests',
    'pdfs',
    'images',
    'client-config',
    'storage-files',
    'avatars',
    'upload',
    'fds-smoke',
]);

/**
 * 同一オリジンの絶対 URL をパスへ正規化する
 * @param {string} urlStr
 * @returns {string}
 */
function normalizeAdminUrlToPath(urlStr) {
    const raw = String(urlStr || '');
    if (!raw.startsWith('http://') && !raw.startsWith('https://')) {
        return raw;
    }
    try {
        const u = new URL(raw);
        if (typeof window !== 'undefined') {
            const here = window.location;
            if (u.origin !== `${here.protocol}//${here.host}`) {
                return raw;
            }
        }
        return `${u.pathname}${u.search}`;
    } catch {
        return raw;
    }
}

/**
 * /admin/tenant/:id/world-edit 上で /admin/* /api/client-config を Tenant API へ向ける
 * @param {string} urlStr
 * @returns {string}
 */
export function rewriteTenantWorldEditApiUrl(urlStr) {
    const raw = normalizeAdminUrlToPath(urlStr);
    const pathName = window.location.pathname;
    // プラットフォーム全体の操作（再起動・設定再読み込み等）は /admin/* のまま
    if (
        raw === '/admin/restart' ||
        raw.startsWith('/admin/restart?') ||
        raw === '/admin/reload-settings' ||
        raw.startsWith('/admin/reload-settings?') ||
        raw === '/admin/planned-restart' ||
        raw.startsWith('/admin/planned-restart?')
    ) {
        return raw;
    }
    const adminMatch = pathName.match(/\/admin\/tenant\/([^/]+)/);
    if (!adminMatch?.[1]) return raw;
    // ワールド編集以外（Tenant 概要など）では書き換えしない
    if (!pathName.includes('/world-edit')) return raw;

    const tenantId = decodeURIComponent(adminMatch[1]);
    const adminBase = `/admin/tenants/${encodeURIComponent(tenantId)}`;

    if (raw === '/api/client-config' || raw.startsWith('/api/client-config?')) {
        return `${adminBase}/client-config${raw.slice('/api/client-config'.length)}`;
    }

    if (raw.startsWith('/admin/tenants/')) {
        const afterTenants = raw.slice('/admin/tenants/'.length);
        const firstSeg = afterTenants.split('/')[0] || '';
        if (firstSeg && firstSeg !== tenantId && TENANT_ADMIN_RESOURCE_SEGMENTS.has(firstSeg)) {
            return `${adminBase}/${afterTenants}`;
        }
        return raw;
    }
    if (raw === '/admin/csrf-token' || raw.startsWith('/admin/csrf-token?')) return raw;
    if (raw.startsWith('/admin/')) {
        return `${adminBase}${raw.slice('/admin'.length)}`;
    }

    return raw;
}
