#!/usr/bin/env node
// scripts/prod-tenant-console-smoke-once.mjs — 本番テナント入場・UI・コンソール診断（読み取りのみ）

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const SIM_ORIGIN = (process.env.SIM_ORIGIN || 'https://sim.mmh-virtual.jp').replace(/\/$/, '');
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts';
const LABEL = process.env.SMOKE_LABEL || 'pre-fix';
const TENANTS = (process.env.TENANT_IDS || 'P-01,P-02,P-03,meta-server').split(',').map((s) => s.trim()).filter(Boolean);

const CONSOLE_PATTERNS = [
    /import map/i,
    /Failed to resolve module specifier/i,
    /three-mesh-ui/i,
    /Multiple instances of Three\.js/i,
    /\[tenant-plugins\] client load failed/i,
    /Maximum call stack/i,
];

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

/**
 * @param {string} tenantId
 * @param {import('@playwright/test').Page} page
 */
async function exerciseTenant(tenantId, page) {
    const consoleLines = [];
    const pageErrors = [];
    page.on('console', (msg) => {
        consoleLines.push({ type: msg.type(), text: msg.text() });
    });
    page.on('pageerror', (err) => {
        pageErrors.push(String(err));
    });

    await page.addInitScript(() => {
        window.__TENANT_E2E_HARNESS__ = '1';
        document.documentElement.dataset.e2eHarness = '1';
        try {
            localStorage.setItem('metaverse-control-scheme', 'keyboard');
            localStorage.setItem('username', `Smoke-${Date.now()}`);
        } catch {
            /* ignore */
        }
    });

    const entryUrl = `${SIM_ORIGIN}/${encodeURIComponent(tenantId)}/`;
    let navigationOk = false;
    let uiVisible = false;
    let ready = false;
    let navError = null;

    try {
        const res = await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        navigationOk = Boolean(res && res.status() < 400);
        await page.waitForTimeout(3000);

        const gate = page.locator('#tenant-login-enter-btn');
        if (await gate.isVisible({ timeout: 5000 }).catch(() => false)) {
            await gate.click();
        }

        const kb = page.locator('#control-scheme-keyboard-btn');
        if (await kb.isVisible({ timeout: 3000 }).catch(() => false)) {
            await kb.click();
        }

        await page.locator('#canvas').waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});
        uiVisible = await page.locator('#canvas').isVisible().catch(() => false);

        const deadline = Date.now() + 90_000;
        while (Date.now() < deadline) {
            ready =
                (await page.evaluate(() => document.documentElement.dataset.tenantMetaverseReady === 'true')) ===
                true;
            if (ready) break;
            await page.waitForTimeout(1000);
        }
    } catch (e) {
        navError = String(e);
    }

    const merged = [
        ...consoleLines.map((l) => `[${l.type}] ${l.text}`),
        ...pageErrors.map((t) => `[pageerror] ${t}`),
    ];
    const flagged = merged.filter((line) => CONSOLE_PATTERNS.some((re) => re.test(line)));

    const shot = path.join(ARTIFACT_DIR, `tenant-smoke-${LABEL}-${tenantId}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});

    return {
        tenantId,
        entryUrl,
        navigationOk,
        uiVisible,
        ready,
        navError,
        consoleTotal: merged.length,
        consoleFlaggedCount: flagged.length,
        consoleFlaggedSample: flagged.slice(0, 12),
        screenshot: shot,
    };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1400, height: 900 },
    locale: 'ja-JP',
});
const results = [];
for (const tenantId of TENANTS) {
    const page = await context.newPage();
    results.push(await exerciseTenant(tenantId, page));
    await page.close();
}
await browser.close();

const reportPath = path.join(ARTIFACT_DIR, `tenant-smoke-report-${LABEL}.json`);
fs.writeFileSync(reportPath, JSON.stringify({ label: LABEL, simOrigin: SIM_ORIGIN, results }, null, 2));
console.log(JSON.stringify({ label: LABEL, reportPath, results }, null, 2));