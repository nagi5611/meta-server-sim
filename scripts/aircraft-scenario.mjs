#!/usr/bin/env node
// scripts/aircraft-scenario.mjs — 飛行シナリオの Playwright 再生と JSON レポート
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { chromium } from 'playwright';
import { aircraftScenarioHarnessInitScript } from '../lib/playwright-aircraft-harness.js';
import { chromiumScenarioLaunchOptions } from '../lib/playwright-scenario-launch.js';
import { prepareTenantPlaywrightEntry } from '../lib/playwright-tenant-entry.js';

const ARTIFACTS = process.env.AIRCRAFT_SCENARIO_ARTIFACTS || '/opt/cursor/artifacts';

/**
 * @param {string[]} argv
 */
function usage() {
    console.error(`Usage: npm run aircraft:scenario -- <scenario.json> [--base URL] [--tenant ID] [--out report.json]`);
    process.exit(2);
}

const args = process.argv.slice(2);
if (!args.length || args.includes('-h') || args.includes('--help')) usage();

let scenarioPath = args[0];
let baseUrl = process.env.E2E_BASE_URL || process.env.AIRCRAFT_SCENARIO_BASE_URL || 'http://localhost:3003';
let tenantId = process.env.E2E_TENANT_ID || process.env.AIRCRAFT_SCENARIO_TENANT || 'P-01';
let outPath = '';

for (let i = 1; i < args.length; i++) {
    if (args[i] === '--base' && args[i + 1]) {
        baseUrl = args[++i];
    } else if (args[i] === '--tenant' && args[i + 1]) {
        tenantId = args[++i];
    } else if (args[i] === '--out' && args[i + 1]) {
        outPath = args[++i];
    }
}

const rawScenario = JSON.parse(await fs.readFile(path.resolve(scenarioPath), 'utf8'));
const scenarioId = String(rawScenario.id || path.basename(scenarioPath, '.json'));
const reportOut =
    outPath ||
    path.join(ARTIFACTS, `aircraft-scenario-${scenarioId}-${Date.now()}.json`);

await fs.mkdir(ARTIFACTS, { recursive: true });

const browser = await chromium.launch(chromiumScenarioLaunchOptions({}));
const url = `${baseUrl.replace(/\/$/, '')}/${encodeURIComponent(tenantId)}/`;
const entryAttempts = Number(process.env.MCP_SCENARIO_ENTRY_ATTEMPTS || 3);
const socketAttempts = Number(process.env.MCP_SCENARIO_SOCKET_ATTEMPTS || 3);

/** @type {import('playwright').Page} */
let page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(aircraftScenarioHarnessInitScript);

let entryError = null;
for (let entryTry = 1; entryTry <= entryAttempts; entryTry += 1) {
    try {
        if (entryTry > 1) {
            await page.close().catch(() => undefined);
            page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
            await page.addInitScript(aircraftScenarioHarnessInitScript);
        }
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
        await prepareTenantPlaywrightEntry(page);
        entryError = null;
        break;
    } catch (err) {
        entryError = err;
        if (entryTry < entryAttempts) {
            await page.waitForTimeout(2000 * entryTry);
        }
    }
}
if (entryError) throw entryError;

const kb = page.locator('#control-scheme-keyboard-btn');
if (await kb.isVisible({ timeout: 2000 }).catch(() => false)) await kb.click();
await page.keyboard.press('KeyW');
await page.waitForTimeout(400);

let socketReady = false;
for (let socketTry = 1; socketTry <= socketAttempts; socketTry += 1) {
    try {
        await page.waitForFunction(
            () => globalThis.__tenantAircraftPluginLoaded && window.__tenantE2E?.runAircraftScenario,
            null,
            { timeout: 120_000 }
        );
        await page.waitForFunction(
            () => Boolean(window.__tenantE2E?.getSocket?.()?.connected),
            null,
            { timeout: 120_000 }
        );
        socketReady = true;
        break;
    } catch (err) {
        if (socketTry >= socketAttempts) throw err;
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 120_000 });
        await prepareTenantPlaywrightEntry(page);
        if (await kb.isVisible({ timeout: 2000 }).catch(() => false)) await kb.click();
        await page.keyboard.press('KeyW');
        await page.waitForTimeout(400);
    }
}
if (!socketReady) {
    throw new Error('socket connect failed after retries');
}

const tp = rawScenario.teleportPosition || { x: 211, y: 1.2, z: 11 };
await page.evaluate(({ x, y, z }) => {
    window.__tenantE2E.setLocalPosition(x, y, z);
}, tp);

const slotId = String(rawScenario.slotId || 'p01-scenario-a320');
await page.waitForFunction(
    (id) => {
        const slots = window.__tenantE2E?.getMetaverseApp?.()?.sceneManager?.getAircraftSlots?.() || [];
        return slots.some((s) => s.id === id);
    },
    slotId,
    { timeout: 120_000 },
);

await page.waitForTimeout(1500);

const report = await page.evaluate(async (scenario) => window.__tenantE2E.runAircraftScenario(scenario), rawScenario);

await fs.writeFile(reportOut, `${JSON.stringify(report, null, 2)}\n`);
if (!report.pass) {
    await fs.writeFile(
        path.join(ARTIFACTS, `aircraft-scenario-${scenarioId}-fail.png`),
        await page.screenshot()
    );
}

await browser.close();

console.log(JSON.stringify({ pass: report.pass, reportPath: reportOut, scenarioId: report.scenarioId }, null, 2));
process.exit(report.pass ? 0 : 1);