#!/usr/bin/env node
/**
 * ステージング CONSOLE の CSP 違反を収集する
 */
import { chromium } from 'playwright';
import dotenv from 'dotenv';

dotenv.config();

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3104';
const FORWARD_HOST = process.env.PLAYWRIGHT_FORWARD_HOST || 'staging.mmh-virtual.jp';
const user = process.env.ADMIN_USERNAME || 'admin';
const pass = process.env.ADMIN_PASSWORD || process.env.SIM_ADMIN_PASSWORD || '';

const paths = [
    '/admin.html',
    '/admin/tenant/P-01',
    '/admin/tenant/P-01/world-edit',
    '/admin.html#settings/env',
];

const violations = [];
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
    httpCredentials: { username: user, password: pass },
    ignoreHTTPSErrors: true,
    serviceWorkers: 'block',
    extraHTTPHeaders: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': FORWARD_HOST },
});

for (const p of paths) {
    const page = await ctx.newPage();
    const local = [];
    page.on('console', (m) => {
        const t = m.text();
        if (t.includes('Content Security Policy') || t.includes('CSP')) local.push(t);
    });
    page.on('pageerror', (e) => local.push(String(e)));
    await page.route('**/*', async (route) => {
        const req = route.request();
        if (!req.url().startsWith(BASE)) return route.continue();
        await route.continue({
            headers: { ...req.headers(), 'x-forwarded-proto': 'https', 'x-forwarded-host': FORWARD_HOST },
        });
    });
    await page.goto(`${BASE}${p}`, { waitUntil: 'load', timeout: 120_000 });
    await page.waitForTimeout(8_000);
    violations.push({ path: p, count: local.length, samples: local.slice(0, 5) });
    await page.close();
}

await browser.close();
const total = violations.reduce((n, v) => n + v.count, 0);
console.log(JSON.stringify({ total, violations }, null, 2));
process.exit(total > 0 ? 1 : 0);