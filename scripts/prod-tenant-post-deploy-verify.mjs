#!/usr/bin/env node
// scripts/prod-tenant-post-deploy-verify.mjs — 全テナント: UI・canvas・3D・コンソール
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const SIM_ORIGIN = (process.env.SIM_ORIGIN || 'https://sim.mmh-virtual.jp').replace(/\/$/, '');
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts';
const LABEL = process.env.SMOKE_LABEL || 'post-deploy';
const TENANTS = (process.env.TENANT_IDS || 'P-01,P-02,P-03,meta-server').split(',').map((s) => s.trim()).filter(Boolean);

const CONSOLE_FLAG = [
    /tenant-pdfjs-shim/i,
    /read only property 'getDocument'/i,
    /\[tenant-plugins\] client load failed/i,
    /Failed to resolve module specifier/i,
];

fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

/**
 * @param {string} tenantId
 * @param {import('@playwright/test').Page} page
 */
async function verifyTenant(tenantId, page) {
    const consoleLines = [];
    const failedReq = [];
    page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
    page.on('requestfailed', (req) => failedReq.push({ url: req.url(), err: req.failure()?.errorText }));

    await page.addInitScript(() => {
        window.__TENANT_E2E_HARNESS__ = '1';
        document.documentElement.dataset.e2eHarness = '1';
        try {
            localStorage.setItem('metaverse-control-scheme', 'keyboard');
            localStorage.setItem('username', `PostDeploy-${Date.now()}`);
        } catch {
            /* ignore */
        }
    });

    const entryUrl = `${SIM_ORIGIN}/${encodeURIComponent(tenantId)}/`;
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const gate = page.locator('#tenant-login-enter-btn');
    if (await gate.isVisible({ timeout: 5000 }).catch(() => false)) await gate.click();

    await page.locator('#canvas').waitFor({ state: 'visible', timeout: 120_000 });
    const deadline = Date.now() + 120_000;
    let ready = false;
    while (Date.now() < deadline) {
        ready = await page.evaluate(() => document.documentElement.dataset.tenantMetaverseReady === 'true');
        if (ready) break;
        await page.waitForTimeout(1000);
    }

    await page.waitForTimeout(18_000);

    const metrics = await page.evaluate(async () => {
        const modal = document.getElementById('video-modal');
        const canvas = document.getElementById('canvas');
        const csModal = modal ? getComputedStyle(modal) : null;
        const csCanvas = canvas ? getComputedStyle(canvas) : null;
        const rectModal = modal?.getBoundingClientRect();
        const rectCanvas = canvas?.getBoundingClientRect();
        const rule = (() => {
            for (const ss of document.styleSheets) {
                try {
                    for (const r of ss.cssRules || []) {
                        if (r.selectorText === '#video-modal') return r.cssText;
                    }
                } catch {
                    /* ignore */
                }
            }
            return null;
        })();

        let glbOk = 0;
        const resources = performance.getEntriesByType('resource').map((e) => e.name);
        glbOk = resources.filter((u) => /\.glb(\?|$)/i.test(u) && !u.includes('avatar')).length;

        let pixelVariance = null;
        const gl = canvas?.getContext('webgl') || canvas?.getContext('webgl2');
        if (gl && canvas && canvas.width > 0) {
            const w = canvas.width;
            const h = canvas.height;
            const buf = new Uint8Array(w * h * 4);
            gl.readPixels(0, Math.floor(h / 2), w, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
            const uniq = new Set();
            for (let i = 0; i < buf.length; i += 4) uniq.add((buf[i] << 16) | (buf[i + 1] << 8) | buf[i + 2]);
            pixelVariance = uniq.size;
        }

        return {
            ready,
            videoModalDisplay: csModal?.display ?? null,
            videoModalVisible: Boolean(
                modal && csModal?.display !== 'none' && rectModal && rectModal.height > 20 && rectModal.top < 200,
            ),
            videoModalGlobalRule: rule,
            canvasTop: rectCanvas?.top ?? null,
            canvasHeight: rectCanvas?.height ?? null,
            canvasPosition: csCanvas?.position ?? null,
            canvasFillsViewport: Boolean(
                rectCanvas && rectCanvas.top < 8 && rectCanvas.height >= window.innerHeight * 0.75,
            ),
            glbResourceCount: glbOk,
            canvasMidRowUniqueColors: pixelVariance,
        };
    });

    const shot = path.join(ARTIFACT_DIR, `post-deploy-${LABEL}-${tenantId}.png`);
    await page.screenshot({ path: shot, fullPage: false });

    const flagged = consoleLines.filter((l) => CONSOLE_FLAG.some((re) => re.test(l)));

    return {
        tenantId,
        entryUrl,
        metrics,
        consoleFlaggedCount: flagged.length,
        consoleFlaggedSample: flagged.slice(0, 8),
        failedCss: failedReq.filter((r) => /\.css/i.test(r.url)).slice(0, 6),
        screenshot: shot,
        pass:
            !metrics.videoModalVisible &&
            metrics.canvasFillsViewport &&
            metrics.ready &&
            (metrics.canvasMidRowUniqueColors ?? 0) > 3,
    };
}

const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--enable-webgl'],
});
const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1400, height: 900 },
    locale: 'ja-JP',
});
const results = [];
for (const tenantId of TENANTS) {
    const page = await context.newPage();
    results.push(await verifyTenant(tenantId, page));
    await page.close();
}
await browser.close();

const reportPath = path.join(ARTIFACT_DIR, `post-deploy-report-${LABEL}.json`);
fs.writeFileSync(reportPath, JSON.stringify({ label: LABEL, simOrigin: SIM_ORIGIN, results }, null, 2));
const allPass = results.every((r) => r.pass);
console.log(JSON.stringify({ allPass, reportPath, results }, null, 2));
process.exitCode = allPass ? 0 : 1;