#!/usr/bin/env node
/**
 * metasim-browser-metamask MCP 相当: P-01 新校舎で FDS 煙フレームが進むか検証
 */
import fs from 'node:fs';
import path from 'node:path';
import {
    closeBrowserSession,
    getOrLaunchBrowserSession,
    navigateApp,
    snapshotPlaywrightPage,
} from '../lib/mcp-browser-metamask.js';
import {
    dismissBlockingModals,
    unlockGameplayPhysics,
} from '../e2e/helpers/tenant-metaverse-agent.mjs';
import {
    installTenantE2EHarness,
    enableDeveloperMode,
} from '../e2e/helpers/tenant-metaverse.mjs';

const ARTIFACT_DIR = process.env.MCP_VERIFY_ARTIFACT_DIR || '/opt/cursor/artifacts';
const TENANT_URL = process.env.BROWSER_METAMASK_BASE_URL || 'https://sim.mmh-virtual.jp/P-01/';
const SMOKE_ID = 'fugaku-prod01-smoke';
const WORLD_ID = 'school';

async function main() {
    fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
    const ctx = await getOrLaunchBrowserSession();
    const page = await ctx.newPage();
    await installTenantE2EHarness(page);
    await enableDeveloperMode(page);
    await page.addInitScript(() => {
        localStorage.setItem('username', `McpFdsFrame-${Date.now()}`);
        localStorage.setItem('metaverse-control-scheme', 'keyboard');
    });

  page.on('console', (msg) => {
        const text = msg.text();
        if (text.includes('[FDS smoke]') || text.includes('FdsSmokeExposure')) {
            console.log(`[browser] ${text}`);
        }
    });

    await page.goto(TENANT_URL, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.waitForFunction(
        () => document.documentElement.dataset.tenantMetaverseReady === 'true',
        null,
        { timeout: 300_000 },
    );
    await dismissBlockingModals(page);
    await unlockGameplayPhysics(page);
    await page.waitForFunction(
        () => Boolean(window.__tenantE2E?.getSocket?.()?.connected),
        null,
        { timeout: 120_000 },
    );

    await page.evaluate(async (wid) => window.__tenantE2E.switchToWorld(wid), WORLD_ID);
    await page.waitForFunction(
        () => window.__tenantE2E?.getCurrentWorldId?.() === 'school',
        null,
        { timeout: 300_000 },
    );
    await page.waitForFunction(
        () => Boolean(window.__tenantE2E?.fdsSmokeHasEntries?.()),
        null,
        { timeout: 300_000 },
    );

    const snapBefore = await snapshotPlaywrightPage(page);
    if (snapBefore.screenshotBase64) {
        fs.writeFileSync(
            path.join(ARTIFACT_DIR, 'fds-verify-school-before.png'),
            Buffer.from(snapBefore.screenshotBase64, 'base64'),
        );
    }

    await page.evaluate(
        async ({ smokeId }) => {
            await window.__tenantE2E.startFdsSmokePlayback(smokeId, {
                fromFrame: 0,
                loop: true,
                secondsPerFrame: 0.15,
            });
        },
        { smokeId: SMOKE_ID },
    );

    const frame0 = await page.evaluate((id) => window.__tenantE2E.getFdsSmokePlaybackFrame(id), SMOKE_ID);
    await page.waitForTimeout(2500);
    const frame1 = await page.evaluate((id) => window.__tenantE2E.getFdsSmokePlaybackFrame(id), SMOKE_ID);
    const snapAfter = await snapshotPlaywrightPage(page);
    if (snapAfter.screenshotBase64) {
        fs.writeFileSync(path.join(ARTIFACT_DIR, 'fds-verify-school-after.png'), Buffer.from(snapAfter.screenshotBase64, 'base64'));
    }

    const report = {
        smokeId: SMOKE_ID,
        frame0,
        frame1,
        advanced: frame1 != null && frame0 != null && Number(frame1) > Number(frame0),
        delta: Number(frame1) - Number(frame0),
    };
    fs.writeFileSync(path.join(ARTIFACT_DIR, 'fds-frame-advance-report.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    await closeBrowserSession();
    process.exit(report.advanced ? 0 : 1);
}

main().catch(async (e) => {
    console.error(e);
    await closeBrowserSession().catch(() => {});
    process.exit(1);
});