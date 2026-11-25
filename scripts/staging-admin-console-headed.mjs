#!/usr/bin/env node
/**
 * ステージングの新 CONSOLE を実データで確認（スクリーンショット）
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

function simOrigin(baseUrl) {
    try {
        return new URL(baseUrl).origin;
    } catch {
        return baseUrl;
    }
}

const SIM_ORIGIN = simOrigin(BASE);

async function attachSimForwardHeaders(page) {
    await page.route('**/*', async (route) => {
        const req = route.request();
        if (!req.url().startsWith(SIM_ORIGIN)) {
            await route.continue();
            return;
        }
        await route.continue({
            headers: {
                ...req.headers(),
                'x-forwarded-proto': 'https',
                'x-forwarded-host': FORWARD_HOST,
            },
        });
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

async function waitApp(page) {
    await page.waitForFunction(
        () => {
            const app = document.getElementById('app');
            return app && !app.hidden && window.MT?.state?.authed;
        },
        { timeout: 120_000 }
    );
    await page.locator('.side').waitFor({ state: 'visible', timeout: 60_000 });
}

async function goTenantView(page, view) {
    const link = page.locator(`.side .nav[data-go="${view}"]`);
    await link.click();
    await Promise.race([
        page.locator(`.side .nav[data-go="${view}"].on`).waitFor({ timeout: 30_000 }),
        page.locator('#main .sheet, #main .dash-chart, #main .ad-row').first().waitFor({ timeout: 30_000 }),
    ]);
}

async function shot(ctx, file, url, after) {
    const page = await ctx.newPage();
    await attachSimForwardHeaders(page);
    await page.goto(url, { waitUntil: 'load', timeout: 120_000 });
    await waitApp(page);
    if (after) await after(page);
    const out = path.join(OUT, file);
    await page.screenshot({ path: out, fullPage: true });
    console.log('saved', out);
    await page.close();
}

const browser = await chromium.launch({ headless: true });
const desktop = await browser.newContext({ ...ctxOpts, viewport: { width: 1280, height: 900 } });

await shot(desktop, 'staging-admin-dashboard.png', `${BASE}/admin.html`);
await shot(desktop, `staging-admin-tenant-status-${TENANT}.png`, `${BASE}/admin/tenant/${TENANT}`, async (p) => {
    await goTenantView(p, 'tenant');
});
await shot(desktop, `staging-admin-tenant-logs-${TENANT}.png`, `${BASE}/admin/tenant/${TENANT}`, async (p) => {
    await goTenantView(p, 'logs');
});
await shot(desktop, `staging-admin-tenant-addons-${TENANT}.png`, `${BASE}/admin/tenant/${TENANT}`, async (p) => {
    await goTenantView(p, 'addons');
    await Promise.race([
        p.locator('.ad-row, .addons, .hint, #main .sheet').first().waitFor({ timeout: 90_000 }),
        p.locator('.side .nav[data-go="addons"].on').waitFor({ timeout: 90_000 }),
    ]);
}).catch((e) => console.error('addons shot failed', e.message));

await shot(desktop, 'staging-admin-settings-env.png', `${BASE}/admin.html`, async (p) => {
    const plat = p.locator('[data-go="platform-settings"]');
    await plat.click({ timeout: 60_000 });
    await p.locator('[data-ps-tabs], #platformSettingsBody').first().waitFor({ timeout: 90_000 });
    await p.locator('[data-ps-save-env], #platformSettingsBody .field').first().waitFor({ timeout: 60_000 });
}).catch((e) => console.error('settings shot failed', e.message));

{
    const page = await desktop.newPage();
    await attachSimForwardHeaders(page);
    await page.goto(`${BASE}/admin/tenant/${TENANT}/world-edit`, { waitUntil: 'load', timeout: 180_000 });
    await waitApp(page);
    await page.locator('body.in-editor').waitFor({ timeout: 60_000 });
    await page.locator('.wed-root, .wed-design-host').waitFor({ timeout: 120_000 });
    await page.locator('#canvas').waitFor({ timeout: 180_000 });
    await page.locator('#world-list .item').first().waitFor({ timeout: 180_000 });
    const out = path.join(OUT, `staging-admin-world-edit-${TENANT}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log('saved', out);
    await page.close();
}

await browser.close();
console.log(JSON.stringify({ ok: true, base: BASE, out: OUT }, null, 2));