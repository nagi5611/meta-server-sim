#!/usr/bin/env node
/**
 * ワールド編集ローディング画面のスクリーンショット（1440×900）
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const BASE = process.env.E2E_BASE_URL || 'http://127.0.0.1:3003';
const user = process.env.ADMIN_USERNAME || 'admin';
const pass = process.env.ADMIN_PASSWORD || 'dev-admin-password-16';
const OUT = process.env.WORLD_LOADING_ARTIFACT_DIR || '/opt/cursor/artifacts/world-edit-loading';

fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
});
await page.context().setHTTPCredentials({ username: user, password: pass });

const forwardHost = process.env.PLAYWRIGHT_FORWARD_HOST || 'staging.mmh-virtual.jp';
await page.route('**/*', async (route) => {
    const req = route.request();
    if (!req.url().startsWith(BASE)) {
        await route.continue();
        return;
    }
    await route.continue({
        headers: {
            ...req.headers(),
            'x-forwarded-proto': 'https',
            'x-forwarded-host': forwardHost,
        },
    });
});

await page.goto(`${BASE}/admin/tenant/P-01/world-edit`, { waitUntil: 'commit', timeout: 120_000 });

const overlay = page.locator('.mt-world-loading');
await overlay.waitFor({ state: 'attached', timeout: 60_000 });

let progressShot = false;
for (let i = 0; i < 100; i++) {
    const hidden = await overlay.getAttribute('hidden');
    const stepClass = await page.locator('.mt-world-loading[class*="ld-bar-step-"]').first().getAttribute('class');
    if (!hidden && stepClass && /ld-bar-step-[3-6]/.test(stepClass)) {
        await page.screenshot({ path: path.join(OUT, '01-loading-in-progress.png') });
        progressShot = true;
        break;
    }
    await page.waitForTimeout(60);
}

if (!progressShot) {
    await page.screenshot({ path: path.join(OUT, '01-loading-in-progress-fallback.png') });
}

await page.locator('.mt-world-loading .d-ok').waitFor({ state: 'visible', timeout: 180_000 });
await page.screenshot({ path: path.join(OUT, '02-loading-complete.png') });

await overlay.waitFor({ state: 'hidden', timeout: 60_000 });
await page.waitForFunction(() => {
    const c = document.querySelector('.wed-root [data-canvas] canvas');
    return c && c.getBoundingClientRect().width > 64;
}, null, { timeout: 180_000 });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(OUT, '03-editor-ready.png') });

await browser.close();
console.log(JSON.stringify({ out: OUT, progressShot }, null, 2));