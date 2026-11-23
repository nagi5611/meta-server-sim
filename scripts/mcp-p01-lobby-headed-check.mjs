#!/usr/bin/env node
/**
 * 本番 P-01 ロビー視認チェック（guest・headed xvfb）。spawn (0,1,5) で広場・樹・地球儀が見えること。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { aircraftScenarioHarnessInitScript } from '../lib/playwright-aircraft-harness.js';
import { chromiumScenarioLaunchOptions } from '../lib/playwright-scenario-launch.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(ROOT);

const BASE = process.env.AIRCRAFT_SCENARIO_BASE_URL || 'https://sim.mmh-virtual.jp';
const ARTIFACTS = process.env.MCP_ARTIFACTS_DIR || '/opt/cursor/artifacts';

/**
 * @param {import('playwright').Page} page
 */
async function waitTenantReady(page, maxMs = 240_000) {
    const gate = page.locator('#tenant-login-enter-btn');
    if (await gate.isVisible({ timeout: 8000 }).catch(() => false)) {
        await gate.click({ timeout: 5000 }).catch(() => undefined);
    }
    const deadline = Date.now() + maxMs;
    while (Date.now() < deadline) {
        const ready = await page.evaluate(
            () => document.documentElement.dataset.tenantMetaverseReady === 'true',
        );
        if (ready) return true;
        await page.waitForTimeout(1000);
    }
    return false;
}

export async function runP01LobbyHeadedCheck(opts = {}) {
    const artifactsDir = opts.artifactsDir || ARTIFACTS;
    const shotName = opts.screenshotName || 'p01-lobby-headed-check.png';
    await fs.mkdir(artifactsDir, { recursive: true });

    const browser = await chromium.launch(chromiumScenarioLaunchOptions({ headless: false }));
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript(aircraftScenarioHarnessInitScript);

    await page.goto(`${BASE}/P-01/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const ready = await waitTenantReady(page);
    const kb = page.locator('#control-scheme-keyboard-btn');
    if (await kb.isVisible({ timeout: 3000 }).catch(() => false)) await kb.click();
    await page.keyboard.press('KeyW');
    await page.waitForTimeout(3000);

    const metrics = await page.evaluate(() => {
        const resources = performance.getEntriesByType('resource').map((e) => e.name);
        const lobbyGlb = resources.some((u) => /lobby\.glb/i.test(u));
        const monumentGlb = resources.some((u) => /monument\.glb/i.test(u));
        let meshCount = 0;
        const scene = window.__tenantE2E?.getMetaverseApp?.()?.sceneManager?.getScene?.();
        scene?.traverse((o) => {
            if (o.isMesh) meshCount += 1;
        });
        const spawn = window.__tenantE2E?.getLocalPosition?.();
        return {
            ready: document.documentElement.dataset.tenantMetaverseReady === 'true',
            lobbyGlb,
            monumentGlb,
            meshCount,
            spawn,
            worldId: window.__tenantE2E?.getCurrentWorldId?.() ?? null,
        };
    });

    const screenshotPath = path.join(artifactsDir, shotName);
    await fs.writeFile(screenshotPath, await page.screenshot());

    const pass =
        ready &&
        metrics.ready &&
        metrics.lobbyGlb &&
        metrics.meshCount >= 30 &&
        metrics.worldId === 'lobby';

    await browser.close();

    const report = {
        checkedAt: new Date().toISOString(),
        pass,
        metrics,
        screenshotPath,
    };
    const out = path.join(artifactsDir, 'p01-lobby-headed-check.json');
    await fs.writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
    return report;
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
    const report = await runP01LobbyHeadedCheck();
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.pass ? 0 : 1);
}