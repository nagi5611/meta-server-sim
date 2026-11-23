#!/usr/bin/env node
/**
 * 本番 P-01 健全性: xvfb + headed Chromium で tenant 初期化を確認（一般利用者と同経路）
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { aircraftScenarioHarnessInitScript } from '../lib/playwright-aircraft-harness.js';
import { chromiumScenarioLaunchOptions, resolvePlaywrightHeadless } from '../lib/playwright-scenario-launch.js';
import { prepareTenantPlaywrightEntry } from '../lib/playwright-tenant-entry.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
process.chdir(ROOT);

const BASE = process.env.AIRCRAFT_SCENARIO_BASE_URL || 'https://sim.mmh-virtual.jp';
const TENANT = 'P-01';
const ARTIFACTS = process.env.MCP_ARTIFACTS_DIR || '/opt/cursor/artifacts';

await fs.mkdir(ARTIFACTS, { recursive: true });

const consoleLines = [];
const pageErrors = [];
const netFails = [];

const browser = await chromium.launch(chromiumScenarioLaunchOptions({}));
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => pageErrors.push(String(e?.message || e)));
page.on('requestfailed', (req) =>
    netFails.push({ url: req.url(), err: req.failure()?.errorText ?? 'unknown' }),
);

await page.addInitScript(aircraftScenarioHarnessInitScript);

const t0 = Date.now();
await page.goto(`${BASE}/${TENANT}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await prepareTenantPlaywrightEntry(page);

const diag = await page.evaluate(() => {
    const e2e = window.__tenantE2E;
    const slots = e2e?.getMetaverseApp?.()?.sceneManager?.getAircraftSlots?.() || [];
    return {
        tenantMetaverseReady: document.documentElement.dataset.tenantMetaverseReady === 'true',
        worldId: e2e?.getCurrentWorldId?.() ?? null,
        socketConnected: Boolean(e2e?.getSocket?.()?.connected),
        aircraftPlugin: Boolean(globalThis.__tenantAircraftPluginLoaded),
        slotIds: slots.map((s) => s.id),
        hasA320: slots.some((s) => s.id === 'p01-scenario-a320'),
    };
});

const screenshotPath = path.join(ARTIFACTS, 'p01-production-health-headed.png');
await fs.writeFile(screenshotPath, await page.screenshot({ fullPage: false }));

const datasetNullInConsole = consoleLines.filter((l) => /dataset.*null|null.*dataset/i.test(l));
const datasetNullInPageError = pageErrors.filter((l) => /dataset/i.test(l));

const report = {
    checkedAt: new Date().toISOString(),
    headed: !resolvePlaywrightHeadless({}),
    loadMs: Date.now() - t0,
    healthy:
        diag.tenantMetaverseReady &&
        diag.socketConnected &&
        diag.hasA320 &&
        datasetNullInPageError.length === 0,
    diag,
    datasetNullErrors: [...datasetNullInConsole, ...datasetNullInPageError],
    pageErrors,
    consoleTail: consoleLines.slice(-60),
    netFails: netFails.slice(0, 20),
    screenshotPath,
};

const out = path.join(ARTIFACTS, 'p01-production-health-report.json');
await fs.writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
await browser.close();

console.log(JSON.stringify({ out, healthy: report.healthy, loadMs: report.loadMs }, null, 2));
process.exit(report.healthy ? 0 : 1);