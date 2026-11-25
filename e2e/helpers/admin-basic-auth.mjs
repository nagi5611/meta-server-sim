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
/**
 * staging 127.0.0.1 向けに X-Forwarded-* を付与（REQUIRE_SECURE_HTTP / テナント URL 解決用）
 * @param {import('@playwright/test').Page} page
 * @param {string} [forwardHost]
 */
export async function attachStagingSimForwardHeaders(page, forwardHost) {
    const host =
        forwardHost || process.env.PLAYWRIGHT_FORWARD_HOST || 'staging.mmh-virtual.jp';
    const base = process.env.E2E_BASE_URL || process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:3104';
    const origin = new URL(base).origin;
    await page.route('**/*', async (route) => {
        const req = route.request();
        if (!req.url().startsWith(origin)) {
            await route.continue();
            return;
        }
        await route.continue({
            headers: {
                ...req.headers(),
                'x-forwarded-proto': 'https',
                'x-forwarded-host': host,
            },
        });
    });
}

export async function adminApiGet(requestContext, path, init = {}) {
    const headers = {
        ...adminBasicAuthHeaders(),
        ...(init.headers || {}),
    };
    return requestContext.get(path, { ...init, headers });
}