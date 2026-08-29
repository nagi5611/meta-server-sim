// lib/tenant-id.js
/** tenant ID: 英数字始まり、英数字とハイフン */
export const TENANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9-]*$/;

/** レジストリ対象外のディレクトリ名 */
export const TENANT_REGISTRY_SKIP = new Set(['_template', '_archive']);

/** プラットフォームルートと衝突する tenant ID */
export const TENANT_ID_RESERVED = new Set([
    'admin',
    'api',
    'dist',
    'js',
    'css',
    'socket.io',
    'node_modules',
    'tenants',
    'data',
    'public',
    'lib',
    'index.html',
    'tenant.html',
    'admin.html',
    'admin-tenant.html',
    'favicon.ico',
]);

/**
 * tenant ID が有効か検証する
 * @param {string} id
 * @returns {boolean}
 */
export function isValidTenantId(id) {
    const s = String(id || '').trim();
    if (!s || TENANT_REGISTRY_SKIP.has(s)) return false;
    return TENANT_ID_PATTERN.test(s);
}

/**
 * 予約 ID かどうか
 * @param {string} id
 * @returns {boolean}
 */
export function isReservedTenantId(id) {
    const s = String(id || '').trim().toLowerCase();
    return TENANT_ID_RESERVED.has(s);
}

/**
 * tenant 作成用 ID バリデーション
 * @param {string} id
 * @returns {{ ok: true, id: string } | { ok: false, error: string, code: string }}
 */
export function validateTenantIdForCreate(id) {
    const s = String(id || '').trim();
    if (!s) {
        return { ok: false, error: 'tenant id is required', code: 'invalid_id' };
    }
    if (!TENANT_ID_PATTERN.test(s)) {
        return {
            ok: false,
            error: 'tenant id must start with alphanumeric and contain only alphanumeric and hyphens',
            code: 'invalid_id',
        };
    }
    if (TENANT_REGISTRY_SKIP.has(s)) {
        return { ok: false, error: 'tenant id is not allowed', code: 'invalid_id' };
    }
    if (isReservedTenantId(s)) {
        return { ok: false, error: 'tenant id conflicts with platform route', code: 'reserved_id' };
    }
    return { ok: true, id: s };
}
