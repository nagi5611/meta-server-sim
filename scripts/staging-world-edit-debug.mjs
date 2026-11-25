#!/usr/bin/env node
import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3104';
const FORWARD_HOST = process.env.PLAYWRIGHT_FORWARD_HOST || 'staging.mmh-virtual.jp';
const user = process.env.ADMIN_USERNAME || 'admin';
const pass = process.env.ADMIN_PASSWORD || process.env.SIM_ADMIN_PASSWORD || '';

const lines = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
    httpCredentials: { username: user, password: pass },
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    extraHTTPHeaders: {
        'X-Forwarded-Proto': 'https',
        'X-Forwarded-Host': FORWARD_HOST,
    },
});
const page = await ctx.newPage();
page.on('console', (m) => lines.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => lines.push(`[pageerror] ${e}`));

await page.route('**/*', async (route) => {
    const req = route.request();
    if (!req.url().startsWith(BASE)) return route.continue();
    await route.continue({
        headers: { ...req.headers(), 'x-forwarded-proto': 'https', 'x-forwarded-host': FORWARD_HOST },
    });
});

await page.goto(`${BASE}/admin/tenant/P-01/world-edit`, { waitUntil: 'load', timeout: 120_000 });
const early = await page.evaluate(async () => ({
    patched: Boolean(window.__adminFetchPatched),
    tenants: await fetch('/admin/tenants', { credentials: 'include' }).then((r) => ({
        status: r.status,
        url: r.url,
    })),
    gateHidden: document.getElementById('gate')?.hidden,
    appHidden: document.getElementById('app')?.hidden,
}));
await page.waitForTimeout(15_000);

const rewriteCheck = await page.evaluate(async () => {
    const mod = await import(`/js/tenant-world-edit-api-paths.js?bust=${Date.now()}`);
    return {
        tenants: mod.rewriteTenantWorldEditApiUrl('/admin/tenants'),
        stats: mod.rewriteTenantWorldEditApiUrl('/admin/stats'),
        hasPlatform: String(mod.rewriteTenantWorldEditApiUrl).includes('PLATFORM_ADMIN_EXACT'),
    };
});

const probe = await page.evaluate(async () => {
    const urls = ['/admin/tenants', '/admin/stats', '/js/mt-design-world-edit-host.js'];
    const out = {};
    for (const u of urls) {
        try {
            const r = await fetch(u, { credentials: 'include' });
            out[u] = { status: r.status, url: r.url };
        } catch (e) {
            out[u] = String(e);
        }
    }
    return out;
});

const snap = await page.evaluate(() => ({
    inEditor: document.body.classList.contains('in-editor'),
    canvas: Boolean(document.querySelector('#canvas')),
    worldList: document.querySelectorAll('#world-list .item').length,
    wedHost: Boolean(document.querySelector('.wed-design-host')),
    wedHidden: document.querySelector('.wed-design-host')?.hidden,
    prodMounted: document.getElementById('main')?.dataset?.prodWorldMounted,
    hasMTDesign: Boolean(window.MTDesignWorldEdit?.mount),
    editorMounted: Boolean(window.ME?.isMounted),
    gateHidden: document.getElementById('gate')?.hidden,
    appHidden: document.getElementById('app')?.hidden,
    authed: window.MT?.state?.authed,
    view: window.MT?.state?.view,
    loading: Boolean(document.querySelector('#wed-loading')),
    mainHtmlLen: document.getElementById('main')?.innerHTML?.length,
}));

console.log(JSON.stringify({ early, rewriteCheck, probe, snap, consoleTail: lines.slice(-40) }, null, 2));
await browser.close();