#!/usr/bin/env node
/** 本番 P-01: 搭乗後シナリオ実行中の飛行スクショ */
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
const BASE = process.env.E2E_BASE_URL || 'https://sim.mmh-virtual.jp';

const scenario = {
    id: 'p01-b787-straight',
    version: 1,
    name: 'screenshot-b787',
    controlMode: 'hard',
    slotId: 'p01-scenario-b787',
    teleportPosition: { x: 213, y: 1.2, z: 7 },
    sampleIntervalMs: 200,
    steps: [{ durationSec: 6, controls: { thrust: 1, yaw: 0, pitch: 0, roll: 0 } }],
    checkpoints: [],
};

const browser = await chromium.launch(chromiumScenarioLaunchOptions({}));
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
await page.addInitScript(aircraftScenarioHarnessInitScript);
await page.goto(`${BASE}/P-01/`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await prepareTenantPlaywrightEntry(page);
await page.waitForFunction(
    () => globalThis.__tenantAircraftPluginLoaded && window.__tenantE2E?.runAircraftScenario,
    null,
    { timeout: 120_000 },
);
await page.evaluate(({ x, y, z }) => window.__tenantE2E.setLocalPosition(x, y, z), scenario.teleportPosition);

const runPromise = page.evaluate(async (s) => window.__tenantE2E.runAircraftScenario(s), scenario);
await page.waitForTimeout(2500);
const shot = path.join(ARTIFACTS, 'prod-aircraft-flying.png');
await fs.writeFile(shot, await page.screenshot());
await runPromise;
await browser.close();
console.log(JSON.stringify({ screenshot: shot }, null, 2));