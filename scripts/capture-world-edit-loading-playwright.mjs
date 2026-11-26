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
const ZIP_HTML =
    process.env.WORLD_LOADING_ZIP_HTML ||
    '/home/ubuntu/.cursor/projects/agent-repos-meta-server-sim/uploads/loading-design-extract/index.html';

fs.mkdirSync(OUT, { recursive: true });

async function attachForwardHeaders(page) {
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
}

/**
 * @param {import('playwright').Page} page
 */
async function captureProgressShot(page) {
    for (let i = 0; i < 400; i++) {
        const ready = await page.evaluate(() => {
            const root = document.querySelector('.mt-world-loading:not([hidden])');
            const pill = document.querySelector('.mt-world-loading .d-pill');
            const title = document.querySelector('.mt-world-loading .d-t');
            if (!root || !pill || !title) return false;
            const step = Number(root.dataset.mtLdStep || 0);
            if (step < 4) return false;
            return (
                pill.textContent.includes('STEP') &&
                title.textContent.length > 3 &&
                root.classList.contains(`ld-bar-step-${step}`) &&
                parseFloat(getComputedStyle(pill).opacity) > 0.85 &&
                parseFloat(getComputedStyle(title).opacity) > 0.85
            );
        });
        if (ready) {
            await page.waitForTimeout(400);
            await page.screenshot({
                path: path.join(OUT, '01-loading-in-progress.png'),
                fullPage: false,
                animations: 'disabled',
            });
            return true;
        }
        await page.waitForTimeout(40);
    }
    await page.screenshot({ path: path.join(OUT, '01-loading-in-progress-fallback.png') });
    return false;
}

/**
 * @param {import('playwright').Page} page
 */
async function captureCompleteShot(page) {
    await page.waitForFunction(
        () => {
            const root = document.querySelector('.mt-world-loading:not([hidden])');
            if (!root || root.classList.contains('is-dismissing')) return false;
            if (root.dataset.mtLdPhase !== 'complete') return false;
            const stage = document.querySelector('.mt-world-loading .ld-stage.is-collapsed');
            const ok = document.querySelector('.mt-world-loading .d-ok');
            const title = document.querySelector('.mt-world-loading .d-t');
            return !!(
                stage &&
                ok &&
                title &&
                ok.textContent.includes('読み込み完了') &&
                title.textContent.includes('を開きました')
            );
        },
        null,
        { timeout: 180_000, polling: 'raf' }
    );
    await page.screenshot({
        path: path.join(OUT, '02-loading-complete.png'),
        fullPage: false,
    });
    return true;
}

/**
 * @param {import('playwright').Page} page
 */
async function captureZipDemo(page) {
    if (!fs.existsSync(ZIP_HTML)) {
        console.warn('[capture] ZIP demo html missing:', ZIP_HTML);
        return;
    }
    const zipUrl = `file://${ZIP_HTML}`;
    await page.goto(zipUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });

    await page.waitForFunction(
        () => {
            const pill = document.querySelector('#desc .d-pill');
            const title = document.querySelector('#desc .d-t');
            if (!pill || !title) return false;
            return pill.textContent.includes('STEP') && title.textContent.length > 3;
        },
        null,
        { timeout: 60_000 }
    );
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(OUT, 'zip-demo-01-in-progress.png'), fullPage: false });

    await page.waitForFunction(
        () => {
            const ok = document.querySelector('#desc .d-ok');
            const stage = document.querySelector('#stage.is-collapsed');
            const title = document.querySelector('#desc .d-t');
            return !!(ok && stage && title && title.textContent.includes('を開きました'));
        },
        null,
        { timeout: 60_000 }
    );
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, 'zip-demo-02-complete.png'), fullPage: false });
}

const browser = await chromium.launch({
    headless: true,
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
});
const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    httpCredentials: { username: user, password: pass },
});
const page = await context.newPage();
await attachForwardHeaders(page);

const completeShotPromise = captureCompleteShot(page);

await page.goto(`${BASE}/admin/tenant/P-01/world-edit`, { waitUntil: 'commit', timeout: 120_000 });
await page.locator('.mt-world-loading').waitFor({ state: 'attached', timeout: 120_000 });

const progressShot = await captureProgressShot(page);
const completeShot = await completeShotPromise;

await page.locator('.mt-world-loading').waitFor({ state: 'hidden', timeout: 60_000 });
await page.waitForFunction(
    () => {
        const c = document.querySelector('.wed-root [data-canvas] canvas');
        return c && c.getBoundingClientRect().width > 64 && !window.MT?.state?.ed?.loading;
    },
    null,
    { timeout: 180_000 }
);
await page.mouse.move(720, 480);
await page.waitForTimeout(350);
const railWidth = await page.locator('.side.rail').evaluate((el) => el.getBoundingClientRect().width);
await page.screenshot({ path: path.join(OUT, '03-editor-ready.png'), fullPage: false });

const zipPage = await context.newPage();
await captureZipDemo(zipPage);

await browser.close();
console.log(JSON.stringify({ out: OUT, progressShot, completeShot, railWidth }, null, 2));