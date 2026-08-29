// public/js/tenant-admin-world-edit-shim.js — ワールド編集 setting.js 向け Tenant 管理 API パス（fetch フォールバック）
import { getTenantIdFromPath } from './tenant-runtime-shim.js';
import { rewriteTenantWorldEditApiUrl } from './tenant-world-edit-api-paths.js';

/**
 * /admin/* と /api/client-config を Tenant 管理 API へ向ける（adminFetch 未適用時のフォールバック）
 */
export function installTenantAdminWorldEditShim() {
    if (window.__tenantAdminWorldEditShimInstalled) return;

    const tenantId = getTenantIdFromPath();
    if (!tenantId) return;

    window.__tenantAdminWorldEditShimInstalled = true;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        if (typeof input === 'string') {
            const rewritten = rewriteTenantWorldEditApiUrl(input);
            if (rewritten !== input) {
                return nativeFetch(rewritten, init);
            }
        }
        return nativeFetch(input, init);
    };
}