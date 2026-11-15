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
        const original =
            typeof input === 'string'
                ? input
                : input instanceof URL
                  ? `${input.pathname}${input.search}`
                  : input instanceof Request
                    ? input.url
                    : String(input);
        const rewritten = rewriteTenantWorldEditApiUrl(original);
        if (rewritten !== original) {
            if (typeof input === 'string' || input instanceof URL) {
                return nativeFetch(rewritten, init);
            }
            if (input instanceof Request) {
                return nativeFetch(new Request(rewritten, input), init);
            }
            return nativeFetch(rewritten, init);
        }
        return nativeFetch(input, init);
    };
}