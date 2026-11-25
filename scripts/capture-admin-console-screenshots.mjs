// scripts/capture-admin-console-screenshots.mjs — CONSOLE admin UI スクリーンショット（モック API）
import { chromium, devices } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3003';
const OUT = process.env.ADMIN_CONSOLE_ARTIFACT_DIR || '/opt/cursor/artifacts';
const TENANT = process.env.E2E_TENANT_ID || 'P-01';
const TENANT_ADMIN_URL = `${BASE}/admin-tenant.html?tenant=${encodeURIComponent(TENANT)}`;

fs.mkdirSync(OUT, { recursive: true });

/**
 * @param {import('playwright').Page} page
 */
async function mockAdminApis(page) {
    await page.route('**/admin/csrf**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ token: 'mock-csrf', expiresAt: Date.now() + 3_600_000 }),
        });
    });
    await page.route('**/admin/stats**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                totalPlayers: 12,
                totalRooms: 3,
                tenantCount: 2,
                cpuUsage: '12%',
                ramUsage: '34%',
                traffic: { bytesPerSecond: 1024, bytesSentLastWindow: 65536, bytesSentTotal: 1_000_000 },
            }),
        });
    });
    await page.route('**/admin/tenants**', async (route) => {
        const url = route.request().url();
        if (/\/stats/.test(url)) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    tenantId: TENANT,
                    displayName: 'デモテナント',
                    players: 4,
                    rooms: 1,
                    worldCount: 2,
                    url: `/${TENANT}/`,
                    traffic: {
                        bytesPerSecond: 512,
                        bytesSentLastWindow: 8192,
                        bytesSentTotal: 50000,
                        bytesPerSecondHuman: '512 B/s',
                        bytesSentLastWindowHuman: '8 KB',
                        bytesSentTotalHuman: '48.8 KB',
                        byCategory: { tenant_r2: 1000 },
                        topPaths: [{ key: '/api/worlds', bytes: 4000, bytesHuman: '3.9 KB' }],
                    },
                }),
            });
            return;
        }
        if (route.request().method() !== 'GET') {
            await route.continue();
            return;
        }
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                tenants: [
                    {
                        id: TENANT,
                        displayName: 'デモテナント',
                        players: 4,
                        status: 'active',
                    },
                ],
            }),
        });
    });
    await page.route(`**/admin/tenant/${TENANT}/plugins**`, async (route) => {
        const url = route.request().url();
        if (route.request().method() === 'GET' && !url.includes('/config')) {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    ok: true,
                    tenantId: TENANT,
                    serverOnline: true,
                    plugins: [
                        {
                            id: 'demo-chat',
                            name: 'デモチャット',
                            description: 'チャット機能のサンプルプラグイン',
                            version: '1.0.0',
                            scope: 'platform',
                            category: 'platform',
                            dependsOn: [],
                            source: 'platform',
                            enabled: true,
                        },
                        {
                            id: 'demo-extended',
                            name: '拡張パック',
                            description: 'demo-chat に依存するサンプル',
                            version: '0.2.0',
                            scope: 'tenant',
                            category: 'tenant',
                            dependsOn: ['demo-chat'],
                            source: 'tenant',
                            enabled: false,
                        },
                    ],
                }),
            });
            return;
        }
        await route.continue();
    });
    await page.route('**/admin/worlds**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ worlds: [{ id: 'lobby', displayName: 'ロビー', modelCount: 3 }] }),
        });
    });
    await page.route('**/admin/env-config**', async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ values: {} }),
        });
    });
}

/**
 * @param {import('playwright').BrowserContext} ctx
 * @param {string} name
 * @param {string} url
 */
async function openAndShot(ctx, name, url, after) {
    const page = await ctx.newPage();
    await mockAdminApis(page);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60_000 });
    await page.locator('body.mt-console').waitFor({ state: 'attached', timeout: 60_000 });
    if (after) await after(page);
    const file = path.join(OUT, name);
    await page.screenshot({ path: file, fullPage: true });
    console.log('saved', file);
    await page.close();
}

const browser = await chromium.launch();
const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const mobile = await browser.newContext({ ...devices['iPhone 13'] });

await openAndShot(desktop, 'admin-platform-dashboard-desktop.png', `${BASE}/admin.html`);
await openAndShot(desktop, 'admin-platform-settings-desktop.png', `${BASE}/admin.html#settings/env`, async (page) => {
    await page.locator('#env-config-save-btn').waitFor({ timeout: 20_000 });
});
await openAndShot(mobile, 'admin-platform-dashboard-mobile.png', `${BASE}/admin.html`);

await openAndShot(desktop, 'admin-tenant-status-desktop.png', TENANT_ADMIN_URL, async (page) => {
    await page.locator('[data-tenant-panel-id="overview"] .head h1').waitFor({ timeout: 15_000 });
});
await openAndShot(desktop, 'admin-tenant-logs-desktop.png', TENANT_ADMIN_URL, async (page) => {
    await page.locator('.side .nav[data-tenant-panel="logs"]').click();
    await page.locator('[data-tenant-panel-id="logs"] .head h1').waitFor({ timeout: 15_000 });
});
await openAndShot(desktop, 'admin-tenant-addons-desktop.png', TENANT_ADMIN_URL, async (page) => {
    await page.locator('.side .nav[data-tenant-panel="plugins"]').click();
    await page.locator('.ad-row').first().waitFor({ timeout: 15_000 });
});
await openAndShot(mobile, 'admin-tenant-addons-mobile.png', TENANT_ADMIN_URL, async (page) => {
    await page.locator('#mt-side-toggle').click();
    await page.locator('.side .nav[data-tenant-panel="plugins"]').click();
    await page.locator('.ad-tools').waitFor({ timeout: 15_000 });
});

await browser.close();