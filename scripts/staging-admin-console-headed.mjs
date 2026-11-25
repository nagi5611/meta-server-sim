#!/usr/bin/env node
/**
 * ステージング／本番の管理 CONSOLE を実データで確認（headed / Playwright）
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3104';
const FORWARD_HOST = process.env.PLAYWRIGHT_FORWARD_HOST || 'staging.mmh-virtual.jp';
const OUT = process.env.MCP_ARTIFACTS_DIR || '/opt/cursor/artifacts';
const TENANT = process.env.E2E_TENANT_ID || 'P-01';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || process.env.SIM_ADMIN_PASSWORD || '';

if (!ADMIN_PASS) {
    console.error('ADMIN_PASSWORD or SIM_ADMIN_PASSWORD required');
    process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });

/** @param {string} baseUrl */
function simOrigin(baseUrl) {
    try {
        return new URL(baseUrl).origin;
    } catch {
        return baseUrl;
    }
}

const SIM_ORIGIN = simOrigin(BASE);

/**
 * CDN モジュールへ X-Forwarded-Host を載せると CORS で失敗するため、シム API 向けだけ付与する。
 * @param {import('playwright').Page} page
 */
async function attachSimForwardHeaders(page) {
    await page.route('**/*', async (route) => {
        const req = route.request();
        if (!req.url().startsWith(SIM_ORIGIN)) {
            await route.continue();
            return;
        }
        const headers = {
            ...req.headers(),
            'x-forwarded-proto': 'https',
            'x-forwarded-host': FORWARD_HOST,
        };
        await route.continue({ headers });
    });
}

const ctxOpts = {
    httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: {
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': FORWARD_HOST,
    },
};

/**
 * @param {import('playwright').BrowserContext} ctx
 * @param {string} file
 * @param {string} url
 * @param {(page: import('playwright').Page) => Promise<void>} [after]
 */
async function shot(ctx, file, url, after) {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 });
    await page.locator('body.mt-console').waitFor({ state: 'attached', timeout: 60_000 });
    if (after) await after(page);
    const out = path.join(OUT, file);
    await page.screenshot({ path: out, fullPage: true });
    console.log('saved', out);
    await page.close();
}

const browser = await chromium.launch({ headless: true });
const desktop = await browser.newContext({ ...ctxOpts, viewport: { width: 1280, height: 900 } });
const mobile = await browser.newContext({ ...ctxOpts, ...devices['iPhone 13'] });

await shot(desktop, `staging-admin-platform-${TENANT}.png`, `${BASE}/admin.html`);
await shot(desktop, `staging-admin-tenant-status-${TENANT}.png`, `${BASE}/admin/tenant/${TENANT}`);
await shot(desktop, `staging-admin-tenant-logs-${TENANT}.png`, `${BASE}/admin/tenant/${TENANT}`, async (page) => {
    await page.locator('.side .nav[data-tenant-panel="logs"]').click();
    await page.locator('[data-tenant-panel-id="logs"].active').waitFor({ timeout: 30_000 });
});
await shot(desktop, `staging-admin-tenant-addons-${TENANT}.png`, `${BASE}/admin/tenant/${TENANT}`, async (page) => {
    await page.locator('.side .nav[data-tenant-panel="plugins"]').click();
    await page.locator('.side .nav[data-tenant-panel].on').waitFor();
    const onCount = await page.locator('.side .nav[data-tenant-panel].on').count();
    if (onCount !== 1) throw new Error(`expected 1 selected nav, got ${onCount}`);
    await page.locator('.ad-row, .mt-disconnected').first().waitFor({ timeout: 30_000 });
});
await shot(
    desktop,
    `staging-admin-settings-${TENANT}.png`,
    `${BASE}/admin.html#settings/env`,
    async (page) => {
        await page.locator('#env-config-save-btn').waitFor({ timeout: 30_000 });
    }
);
await shot(mobile, `staging-admin-tenant-addons-mobile-${TENANT}.png`, `${BASE}/admin/tenant/${TENANT}`, async (page) => {
    await page.locator('#mt-side-toggle').click();
    await page.locator('.side .nav[data-tenant-panel="plugins"]').click();
    await page.locator('.ad-tools, .mt-disconnected').first().waitFor({ timeout: 30_000 });
});
{
    const page = await desktop.newPage();
    await attachSimForwardHeaders(page);
    await page.goto(`${BASE}/admin/tenant/${TENANT}/world-edit`, { waitUntil: 'networkidle', timeout: 120_000 });
    await page.locator('body.mt-console').waitFor({ state: 'attached', timeout: 90_000 });
    await page.locator('.wed-root').waitFor({ timeout: 60_000 });
    await page.locator('.admin-sidebar').waitFor({ state: 'detached', timeout: 5_000 }).catch(() => {});
    const out = path.join(OUT, `staging-admin-world-edit-${TENANT}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log('saved', out);
    await page.close();
}
await shot(
    desktop,
    `staging-admin-tenant-topbar-${TENANT}.png`,
    `${BASE}/admin/tenant/${TENANT}`,
    async (page) => {
        await page.locator('.topbar-actions').waitFor({ timeout: 30_000 });
    }
);

const loginCtx = await browser.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': FORWARD_HOST },
});
const loginPage = await loginCtx.newPage();
await loginPage.goto(`${BASE}/admin.html`, { waitUntil: 'commit', timeout: 30_000 });
await loginPage.screenshot({ path: path.join(OUT, `staging-admin-login-${TENANT}.png`), fullPage: true });
console.log('saved', path.join(OUT, `staging-admin-login-${TENANT}.png`));
await loginPage.close();
await loginCtx.close();

await browser.close();
console.log(JSON.stringify({ ok: true, base: BASE, out: OUT }, null, 2));