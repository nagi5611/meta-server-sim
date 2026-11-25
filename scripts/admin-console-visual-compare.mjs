#!/usr/bin/env node
/**
 * プロトタイプ vs ステージング CONSOLE 見た目比較（1440x900）
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import dotenv from 'dotenv';

dotenv.config();

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ART = process.env.MCP_ARTIFACTS_DIR || '/opt/cursor/artifacts';
const VIEWPORT = { width: 1440, height: 900 };
const PROTO_PORT = Number(process.env.ADMIN_PROTO_PORT || '5199');
const PROTO = `http://127.0.0.1:${PROTO_PORT}/index.html`;
const STAGING = process.env.E2E_BASE_URL || 'http://127.0.0.1:3104';
const FORWARD_HOST = process.env.PLAYWRIGHT_FORWARD_HOST || 'staging.mmh-virtual.jp';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || process.env.SIM_ADMIN_PASSWORD || '';

/** @type {{ id: string, label: string, prepare: (page: import('playwright').Page) => Promise<void> }[]} */
const SCENES = [
    {
        id: 'dashboard',
        label: 'ダッシュボード',
        prepare: async (page) => {
            await clickNav(page, 'dash');
        },
    },
    {
        id: 'tenant-list',
        label: 'テナント一覧',
        prepare: async (page) => {
            await clickNav(page, 'dash');
            await page.waitForTimeout(300);
        },
    },
    {
        id: 'tenant-detail',
        label: 'テナント詳細',
        prepare: async (page) => {
            await openTenant(page, prototypeTenant(page));
            await clickNav(page, 'tenant');
        },
    },
    {
        id: 'tenant-logs',
        label: '通信ログ',
        prepare: async (page) => {
            await openTenant(page, prototypeTenant(page));
            await clickNav(page, 'logs');
        },
    },
    {
        id: 'tenant-addons',
        label: 'アドオン',
        prepare: async (page) => {
            await openTenant(page, prototypeTenant(page));
            await clickNav(page, 'addons');
        },
    },
    {
        id: 'world-edit',
        label: 'ワールド編集',
        prepare: async (page) => {
            const url = page.url();
            if (isPrototypeUrl(url)) {
                await page.evaluate(() => {
                    const st = window.MT.state;
                    st.tenant = 'mmh';
                    st.view = 'world';
                    const tw = window.MTD.TENANTS.find((t) => t.id === 'mmh');
                    st.worldId = tw?.worlds?.[0]?.id || null;
                    window.MTA.initEd(st);
                    window.MT.render();
                });
                await page.waitForSelector('.wed-root', { timeout: 90_000 });
                await page.waitForTimeout(1200);
            } else {
                await page.goto(`${STAGING}/admin/tenant/P-01/world-edit`, { waitUntil: 'load' });
                await waitConsole(page);
                await page.waitForSelector('.wed-root', { timeout: 120_000 });
                await page.waitForFunction(
                    () => {
                        const c = document.querySelector('.wed-root [data-canvas] canvas');
                        return c && c.getBoundingClientRect().width > 64;
                    },
                    null,
                    { timeout: 120_000 }
                );
            }
        },
    },
    {
        id: 'platform-settings',
        label: 'プラットフォーム設定',
        prepare: async (page) => {
            if (isPrototypeUrl(page.url())) {
                return;
            }
            await page.goto(`${STAGING}/admin.html#settings/env`, { waitUntil: 'load' });
            await waitConsole(page);
            await page.locator('[data-ps-tabs], #platformSettingsBody, .ps-shell').first().waitFor({
                timeout: 90_000,
            });
        },
    },
];

async function waitConsole(page) {
    await page.waitForFunction(
        () => document.getElementById('app') && !document.getElementById('app').hidden,
        null,
        { timeout: 120_000 }
    );
}

async function loginPrototype(page) {
    await page.goto(PROTO, { waitUntil: 'load', timeout: 120_000 });
    await page.locator('#gUser').fill('admin');
    await page.locator('#gPass').fill('admin1234');
    await page.locator('#gateForm button[type="submit"]').click();
    await waitConsole(page);
}

async function loginStaging(page) {
    await page.goto(`${STAGING}/admin.html`, { waitUntil: 'load', timeout: 120_000 });
    await waitConsole(page);
}

async function openTenant(page, tenantId) {
    const picker = page.locator('[data-act="picker"]').first();
    if (await picker.count()) {
        await picker.click();
        await page.locator(`.pop-item[data-tenant="${tenantId}"]`).click({ timeout: 15_000 });
        await page.waitForTimeout(300);
        return;
    }
    const pop = page.locator(`.pop-item[data-tenant="${tenantId}"], [data-tenant="${tenantId}"]`).first();
    const row = page.locator(`[data-act="open-tenant"][data-tenant="${tenantId}"], .t-row[data-tenant="${tenantId}"]`).first();
    if (await row.count()) await row.click();
    else if (await pop.count()) await pop.click();
    else {
        await page.evaluate((id) => {
            window.MT.state.tenant = id;
            window.MT.state.view = 'tenant';
            window.MT.render();
        }, tenantId);
    }
    await page.waitForTimeout(400);
}

function isPrototypeUrl(url) {
    return url.includes(`127.0.0.1:${PROTO_PORT}`);
}

function prototypeTenant(page) {
    return isPrototypeUrl(page.url()) ? 'mmh' : 'P-01';
}

async function clickNav(page, view) {
    const nav = page.locator(`.side .nav[data-go="${view}"]`);
    if (await nav.count()) await nav.first().click();
    else {
        await page.evaluate((v) => {
            window.MT.state.view = v;
            window.MT.render();
        }, view);
    }
    await page.waitForTimeout(500);
}

async function shot(page, outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    await page.screenshot({ path: outPath, fullPage: false });
}

function compareImages(aPath, bPath, diffPath) {
    const a = PNG.sync.read(fs.readFileSync(aPath));
    const b = PNG.sync.read(fs.readFileSync(bPath));
    const w = Math.min(a.width, b.width);
    const h = Math.min(a.height, b.height);
    const out = new PNG({ width: w, height: h });
    const ca = new PNG({ width: w, height: h });
    const cb = new PNG({ width: w, height: h });
    PNG.bitblt(a, ca, 0, 0, w, h, 0, 0);
    PNG.bitblt(b, cb, 0, 0, w, h, 0, 0);
    const diffPx = pixelmatch(ca.data, cb.data, out.data, w, h, { threshold: 0.12 });
    fs.writeFileSync(diffPath, PNG.sync.write(out));
    return { diffPx, total: w * h, ratio: diffPx / (w * h) };
}

async function attachStagingHeaders(page) {
    await page.route('**/*', async (route) => {
        const req = route.request();
        if (!req.url().startsWith(STAGING)) return route.continue();
        await route.continue({
            headers: { ...req.headers(), 'x-forwarded-proto': 'https', 'x-forwarded-host': FORWARD_HOST },
        });
    });
}

import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.jsx': 'text/plain; charset=utf-8',
};

const designRoot = path.join(ROOT, 'docs/design/admin-console');
const protoServer = createServer((req, res) => {
    const rel = decodeURIComponent((req.url || '/').split('?')[0]);
    const safe = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
    const file = path.join(designRoot, safe === '/' ? 'index.html' : safe);
    if (!file.startsWith(designRoot) || !existsSync(file) || !statSync(file).isFile()) {
        res.statusCode = 404;
        res.end('not found');
        return;
    }
    res.setHeader('Content-Type', MIME[path.extname(file)] || 'application/octet-stream');
    createReadStream(file).pipe(res);
});
await new Promise((resolve) => protoServer.listen(PROTO_PORT, '127.0.0.1', resolve));

const browser = await chromium.launch({ headless: true });
const results = [];

{
    const ctx = await browser.newContext({ viewport: VIEWPORT });
    const page = await ctx.newPage();
    await loginPrototype(page);
    for (const scene of SCENES) {
        if (scene.id === 'platform-settings') continue;
        await scene.prepare(page);
        const out = path.join(ART, `prototype-${scene.id}-1440x900.png`);
        await shot(page, out);
    }
    await ctx.close();
}

{
    if (!ADMIN_PASS) {
        console.error('ADMIN_PASSWORD required for staging shots');
        process.exit(2);
    }
    const ctx = await browser.newContext({
        viewport: VIEWPORT,
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
        ignoreHTTPSErrors: true,
        serviceWorkers: 'block',
        extraHTTPHeaders: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': FORWARD_HOST },
    });
    const page = await ctx.newPage();
    await attachStagingHeaders(page);
    await loginStaging(page);
    for (const scene of SCENES) {
        await scene.prepare(page);
        const out = path.join(ART, `staging-${scene.id}-1440x900.png`);
        await shot(page, out);
    }
    await ctx.close();
}

for (const scene of SCENES) {
    const proto = path.join(ART, `prototype-${scene.id}-1440x900.png`);
    const stag = path.join(ART, `staging-${scene.id}-1440x900.png`);
    const diff = path.join(ART, `compare-${scene.id}-diff.png`);
    if (scene.id === 'platform-settings') continue;
    if (!fs.existsSync(proto) || !fs.existsSync(stag)) continue;
    const stats = compareImages(proto, stag, diff);
    results.push({ scene: scene.id, label: scene.label, ...stats, diffPath: diff });
}

await browser.close();
protoServer.close();
console.log(JSON.stringify({ viewport: VIEWPORT, results }, null, 2));
const bad = results.filter((r) => r.ratio > 0.08);
process.exit(bad.length ? 1 : 0);