// lib/mcp-aircraft-scenario-run.js — 飛行シナリオ再生（scripts/aircraft-scenario.mjs と同経路）

import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';
import { validateAircraftScenario } from '../addons/aircraft/lib/aircraft-scenario-schema.js';
import {
    PLAYWRIGHT_SCENARIO_BROWSER_ARGS,
    aircraftScenarioHarnessInitScript,
} from './playwright-aircraft-harness.js';
import { prepareTenantPlaywrightEntry } from './playwright-tenant-entry.js';

/**
 * @param {import('../addons/aircraft/lib/aircraft-scenario-types.js').AircraftScenario} scenario
 * @param {{
 *   baseUrl: string,
 *   tenantId: string,
 *   artifactsDir?: string,
 *   teleportNearSlot?: boolean,
 *   headless?: boolean,
 * }} opts
 */
export async function runAircraftScenarioInBrowser(scenario, opts) {
    const validated = validateAircraftScenario(scenario);
    if (!validated.ok) {
        return {
            pass: false,
            errors: validated.errors,
            scenarioId: String(scenario?.id || 'invalid'),
        };
    }
    const sc = validated.scenario;
    const artifactsDir =
        opts.artifactsDir ||
        process.env.MCP_ARTIFACTS_DIR ||
        process.env.ARTIFACTS ||
        '/opt/cursor/artifacts';
    await fs.mkdir(artifactsDir, { recursive: true });

    const browser = await chromium.launch({
        headless: opts.headless !== false,
        args: PLAYWRIGHT_SCENARIO_BROWSER_ARGS,
    });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
    await page.addInitScript(aircraftScenarioHarnessInitScript);
    await page.addInitScript(() => {
        localStorage.setItem('username', `McpScenario-${Date.now()}`);
    });

    const url = `${opts.baseUrl.replace(/\/$/, '')}/${encodeURIComponent(opts.tenantId)}/`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await prepareTenantPlaywrightEntry(page);

    const kb = page.locator('#control-scheme-keyboard-btn');
    if (await kb.isVisible({ timeout: 2000 }).catch(() => false)) await kb.click();
    await page.keyboard.press('KeyW');
    await page.waitForTimeout(400);

    await page.waitForFunction(
        () => globalThis.__tenantAircraftPluginLoaded && window.__tenantE2E?.runAircraftScenario,
        null,
        { timeout: 120_000 },
    );
    await page.waitForFunction(
        () => Boolean(window.__tenantE2E?.getSocket?.()?.connected),
        null,
        { timeout: 120_000 },
    );

    const rawTeleport =
        scenario && typeof scenario === 'object' && !Array.isArray(scenario) && scenario.teleportPosition
            ? scenario.teleportPosition
            : null;
    const teleport = rawTeleport || { x: 211, y: 1.2, z: 11 };
    if (opts.teleportNearSlot !== false) {
        await page.evaluate(({ x, y, z }) => {
            window.__tenantE2E?.setLocalPosition?.(x, y, z);
        }, teleport);
        await page.waitForTimeout(1200);
    }

    const slotWait = sc.slotId || 'p01-scenario-a320';
    await page.waitForFunction(
        (id) => {
            const slots = window.__tenantE2E?.getMetaverseApp?.()?.sceneManager?.getAircraftSlots?.() || [];
            return slots.some((s) => s.id === id);
        },
        slotWait,
        { timeout: 120_000 },
    );
    await page.waitForTimeout(1000);

    const report = await page.evaluate(
        async (scenarioArg) => window.__tenantE2E.runAircraftScenario(scenarioArg),
        sc,
    );

    const reportPath = path.join(
        artifactsDir,
        `aircraft-scenario-${sc.id}-${Date.now()}.json`,
    );
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);

    if (!report.pass || opts.captureScreenshot) {
        const suffix = report.pass ? 'ok' : 'fail';
        const shot = path.join(artifactsDir, `aircraft-scenario-${sc.id}-${suffix}.png`);
        await fs.writeFile(shot, await page.screenshot());
        report.screenshotPath = shot;
    }
    report.reportPath = reportPath;

    await browser.close();
    return report;
}

/**
 * @param {string | Record<string, unknown>} scenarioOrPath
 * @param {Parameters<typeof runAircraftScenarioInBrowser>[1]} opts
 */
export async function runAircraftScenarioFromPathOrObject(scenarioOrPath, opts) {
    let scenario = scenarioOrPath;
    if (typeof scenarioOrPath === 'string') {
        const full = path.resolve(scenarioOrPath);
        scenario = JSON.parse(await fs.readFile(full, 'utf8'));
    }
    return runAircraftScenarioInBrowser(
        /** @type {import('../addons/aircraft/lib/aircraft-scenario-types.js').AircraftScenario} */ (scenario),
        opts,
    );
}