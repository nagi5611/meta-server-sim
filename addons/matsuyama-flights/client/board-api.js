// addons/matsuyama-flights/client/board-api.js — テナント向け発着 API URL
/**
 * @returns {string|null}
 */
export function getTenantIdFromLocation() {
    if (typeof window === 'undefined') return null;
    const parts = String(window.location.pathname || '')
        .split('/')
        .filter(Boolean);
    const first = parts[0];
    if (!first || first === 'admin' || first === 'api') return null;
    return decodeURIComponent(first);
}

/**
 * 発着 JSON の取得先（レガシー `/api/addons/...` はテナントプレフィックス付き）
 * @returns {string}
 */
export function resolveMatsuyamaFlightsBoardUrl() {
    const tenantId = getTenantIdFromLocation();
    if (tenantId) {
        return `/${encodeURIComponent(tenantId)}/api/addons/matsuyama-flights/board`;
    }
    return '/api/addons/matsuyama-flights/board';
}