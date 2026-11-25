#!/usr/bin/env node
/**
 * ステージング／本番の管理 CONSOLE を実データで確認（headed / Playwright）
 */
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'https://staging.mmh-virtual.jp:3104';
const OUT = process.env.MCP_ARTIFACTS_DIR || '/opt/cursor/artifacts';
const TENANT = process.env.E2E_TENANT_ID || 'P-01';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || process.env.SIM_ADMIN_PASSWORD || '';

if (!ADMIN_PASS) {
    console.error('ADMIN_PASSWORD or SIM_ADMIN_PASSWORD required');
    process.exit(2);
}

fs.mkdirSync(OUT, { recursive: true });

const ctxOpts = {
    httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    ignoreHTTPSErrors: true,
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

await browser.close();
console.log(JSON.stringify({ ok: true, base: BASE, out: OUT }, null, 2));