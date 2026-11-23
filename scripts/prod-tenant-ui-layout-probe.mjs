#!/usr/bin/env node
// scripts/prod-tenant-ui-layout-probe.mjs — 配信モーダル露出・CSS 適用の本番プローブ
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const SIM_ORIGIN = (process.env.SIM_ORIGIN || 'https://sim.mmh-virtual.jp').replace(/\/$/, '');
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts';
const TENANTS = (process.env.TENANT_IDS || 'P-01,P-02,P-03,meta-server').split(',').map((s) => s.trim()).filter(Boolean);
const LABEL = process.env.SMOKE_LABEL || 'ui-layout-probe';

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

/**
 * @param {string} tenantId
 * @param {import('@playwright/test').Page} page
 */
async function probeTenant(tenantId, page) {
    const failedReq = [];
    page.on('requestfailed', (req) => {
        failedReq.push({ url: req.url(), err: req.failure()?.errorText || 'failed' });
    });

    await page.addInitScript(() => {
        window.__TENANT_E2E_HARNESS__ = '1';
        document.documentElement.dataset.e2eHarness = '1';
        try {
            localStorage.setItem('metaverse-control-scheme', 'keyboard');
            localStorage.setItem('username', `UILayoutProbe-${Date.now()}`);
        } catch {
            /* ignore */
        }
    });

    const entryUrl = `${SIM_ORIGIN}/${encodeURIComponent(tenantId)}/`;
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });

    const gate = page.locator('#tenant-login-enter-btn');
    if (await gate.isVisible({ timeout: 5000 }).catch(() => false)) await gate.click();

    await page.locator('#canvas').waitFor({ state: 'visible', timeout: 90_000 }).catch(() => {});

    const ui = await page.evaluate(() => {
        const modal = document.getElementById('video-modal');
        const canvas = document.getElementById('canvas');
        const csModal = modal ? getComputedStyle(modal) : null;
        const csCanvas = canvas ? getComputedStyle(canvas) : null;
        const rectModal = modal?.getBoundingClientRect();
        const rectCanvas = canvas?.getBoundingClientRect();
        const sheets = [...document.styleSheets].map((ss) => {
            try {
                return { href: ss.href, rules: ss.cssRules?.length ?? -1 };
            } catch {
                return { href: ss.href, rules: -1 };
            }
        });
        const videoModalRule = (() => {
            for (const ss of document.styleSheets) {
                try {
                    for (const rule of ss.cssRules || []) {
                        if (rule.selectorText && /#video-modal\b/.test(rule.selectorText)) {
                            return { href: ss.href, selector: rule.selectorText, cssText: rule.cssText.slice(0, 120) };
                        }
                    }
                } catch {
                    /* cross-origin */
                }
            }
            return null;
        })();
        return {
            videoModalPresent: Boolean(modal),
            videoModalDisplay: csModal?.display ?? null,
            videoModalPosition: csModal?.position ?? null,
            videoModalVisible: Boolean(modal && csModal && csModal.display !== 'none' && rectModal && rectModal.height > 0),
            videoModalRect: rectModal
                ? { top: rectModal.top, height: rectModal.height, width: rectModal.width }
                : null,
            canvasRect: rectCanvas ? { top: rectCanvas.top, height: rectCanvas.height } : null,
            canvasPosition: csCanvas?.position ?? null,
            bodyChildCount: document.body.children.length,
            styleSheets: sheets,
            sampleVideoModalRule: videoModalRule,
        };
    });

    const shot = path.join(ARTIFACT_DIR, `ui-layout-${LABEL}-${tenantId}.png`);
    await page.screenshot({ path: shot, fullPage: true });

    return { tenantId, entryUrl, ui, failedReq: failedReq.filter((r) => /\.css|\/assets\//i.test(r.url)).slice(0, 12), screenshot: shot };
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 900 }, locale: 'ja-JP' });
const results = [];
for (const tenantId of TENANTS) {
    const page = await context.newPage();
    results.push(await probeTenant(tenantId, page));
    await page.close();
}
await browser.close();

const reportPath = path.join(ARTIFACT_DIR, `ui-layout-report-${LABEL}.json`);
fs.writeFileSync(reportPath, JSON.stringify({ label: LABEL, simOrigin: SIM_ORIGIN, results }, null, 2));
console.log(JSON.stringify({ reportPath, results }, null, 2));