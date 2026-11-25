/**
 * 管理 API 用 Basic 認証ヘッダ（Playwright request が httpCredentials を継承しない場合の保険）
 * @param {string} [user]
 * @param {string} [pass]
 */
export function adminBasicAuthHeaders(user, pass) {
    const u = user || process.env.ADMIN_USERNAME || 'admin';
    const p = pass || process.env.ADMIN_PASSWORD || process.env.SIM_ADMIN_PASSWORD || '';
    if (!p) return {};
    const token = Buffer.from(`${u}:${p}`, 'utf8').toString('base64');
    return { Authorization: `Basic ${token}` };
}

/**
 * @param {import('@playwright/test').APIRequestContext} requestContext
 * @param {string} path
 * @param {RequestInit} [init]
 */
export async function adminApiGet(requestContext, path, init = {}) {
    const headers = {
        ...adminBasicAuthHeaders(),
        ...(init.headers || {}),
    };
    return requestContext.get(path, { ...init, headers });
}