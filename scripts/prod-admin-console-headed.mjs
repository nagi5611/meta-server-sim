#!/usr/bin/env node
/** 本番管理 CONSOLE スクリーンショット（サーバー上で実行推奨） */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3004';
const FORWARD_HOST = process.env.PLAYWRIGHT_FORWARD_HOST || 'sim.mmh-virtual.jp';
const OUT = process.env.MCP_ARTIFACTS_DIR || '/opt/cursor/artifacts';
const TENANT = process.env.E2E_TENANT_ID || 'P-01';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || process.env.SIM_ADMIN_PASSWORD || '';

if (!ADMIN_PASS) process.exit(2);
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

/** @param {import('playwright').Page} page */
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

const ctxBase = {
    httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': FORWARD_HOST },
};

async function shot(ctx, file, url, after) {
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120_000 });
    await page.locator('body.mt-console').waitFor({ timeout: 60_000 });
    if (after) await after(page);
    await page.screenshot({ path: path.join(OUT, file), fullPage: true });
    console.log('saved', file);
    await page.close();
}

const browser = await chromium.launch({ headless: true });
const desktop = await browser.newContext({ ...ctxBase, viewport: { width: 1280, height: 900 } });
const mobile = await browser.newContext({ ...ctxBase, ...devices['iPhone 13'] });

await shot(desktop, 'prod-admin-platform-desktop.png', `${BASE}/admin.html`);
await shot(desktop, 'prod-admin-tenant-status-desktop.png', `${BASE}/admin/tenant/${TENANT}`);
await shot(desktop, 'prod-admin-tenant-addons-desktop.png', `${BASE}/admin/tenant/${TENANT}`, async (p) => {
    await p.locator('.side .nav[data-tenant-panel="plugins"]').click();
    await p.locator('.ad-row, .mt-disconnected').first().waitFor({ timeout: 30_000 });
});
await shot(mobile, 'prod-admin-tenant-addons-mobile.png', `${BASE}/admin/tenant/${TENANT}`, async (p) => {
    await p.locator('#mt-side-toggle').click();
    await p.locator('.side .nav[data-tenant-panel="plugins"]').click();
});
await shot(desktop, 'prod-admin-settings-desktop.png', `${BASE}/admin.html#settings/env`, async (p) => {
    await p.locator('#env-config-save-btn').waitFor({ timeout: 30_000 });
});
{
    const page = await desktop.newPage();
    await attachSimForwardHeaders(page);
    await page.goto(`${BASE}/admin/tenant/${TENANT}/world-edit`, { waitUntil: 'networkidle', timeout: 120_000 });
    await page.locator('body.mt-console').waitFor({ timeout: 90_000 });
    await page.locator('.wed-root').waitFor({ timeout: 60_000 });
    await page.screenshot({ path: path.join(OUT, 'prod-admin-world-edit-desktop.png'), fullPage: true });
    console.log('saved prod-admin-world-edit-desktop.png');
    await page.close();
}
await shot(desktop, 'prod-admin-tenant-topbar-desktop.png', `${BASE}/admin/tenant/${TENANT}`, async (p) => {
    await p.locator('.topbar-actions').waitFor({ timeout: 30_000 });
});

const loginCtx = await browser.newContext({
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': FORWARD_HOST },
});
const loginPage = await loginCtx.newPage();
await loginPage.goto(`${BASE}/admin.html`, { waitUntil: 'commit', timeout: 30_000 });
await loginPage.screenshot({ path: path.join(OUT, 'prod-admin-login-desktop.png'), fullPage: true });
console.log('saved prod-admin-login-desktop.png');
await loginPage.close();
await loginCtx.close();

await browser.close();