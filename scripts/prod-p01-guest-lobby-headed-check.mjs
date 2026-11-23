#!/usr/bin/env node
/**
 * 本番 P-01 ゲスト視点ロビー確認（xvfb + headed、スポーン・モデル数・スクショ）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { aircraftScenarioHarnessInitScript } from '../lib/playwright-aircraft-harness.js';
import { chromiumScenarioLaunchOptions } from '../lib/playwright-scenario-launch.js';
import { prepareTenantPlaywrightEntry } from '../lib/playwright-tenant-entry.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(ROOT);
const ARTIFACTS = process.env.MCP_ARTIFACTS_DIR || '/opt/cursor/artifacts';
const BASE = process.env.AIRCRAFT_SCENARIO_BASE_URL || 'https://sim.mmh-virtual.jp';

await fs.mkdir(ARTIFACTS, { recursive: true });

const browser = await chromium.launch(chromiumScenarioLaunchOptions({}));
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(aircraftScenarioHarnessInitScript);

await page.goto(`${BASE}/P-01/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await prepareTenantPlaywrightEntry(page);

const kb = page.locator('#control-scheme-keyboard-btn');
if (await kb.isVisible({ timeout: 2000 }).catch(() => false)) await kb.click();

const diag = await page.evaluate(async () => {
    const worlds = await fetch('/P-01/api/worlds').then((r) => r.json());
    const lobby = worlds.lobby || {};
    const wm = window.__tenantMetaverseApp?.worldManager;
    const pos = window.__tenantE2E?.getLocalPosition?.();
    return {
        tenantMetaverseReady: document.documentElement.dataset.tenantMetaverseReady === 'true',
        worldId: window.__tenantE2E?.getCurrentWorldId?.() ?? null,
        spawnPoint: lobby.spawnPoint ?? null,
        lobbyModelCount: Array.isArray(lobby.models) ? lobby.models.length : null,
        loadedModelCount: wm?.getCurrentWorld?.()?.models?.length ?? null,
        localPosition: pos,
        viewDistanceM:
            window.__tenantMetaverseApp?.sceneManager?.graphicsOptions?.viewDistanceM ?? null,
    };
});

const screenshotPath = path.join(ARTIFACTS, 'p01-guest-lobby-headed.png');
await fs.writeFile(screenshotPath, await page.screenshot({ fullPage: false, timeout: 90_000 }));

const spawnOk =
    diag.spawnPoint &&
    Math.abs(Number(diag.spawnPoint.x)) < 0.01 &&
    Math.abs(Number(diag.spawnPoint.y) - 1) < 0.01 &&
    Math.abs(Number(diag.spawnPoint.z) - 5) < 0.01;

const report = {
    checkedAt: new Date().toISOString(),
    pass:
        diag.tenantMetaverseReady &&
        diag.worldId === 'lobby' &&
        spawnOk &&
        (diag.loadedModelCount ?? 0) > 3,
    diag,
    screenshotPath,
};

const out = path.join(ARTIFACTS, 'p01-guest-lobby-headed-report.json');
await fs.writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
await browser.close();
console.log(JSON.stringify({ pass: report.pass, out, screenshotPath }, null, 2));
process.exit(report.pass ? 0 : 1);