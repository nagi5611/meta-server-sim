// e2e/aircraft-scenario-p01.spec.js — P-01 飛行シナリオ一括検証
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { enterWorld } from './helpers/tenant-metaverse-agent.mjs';

const ARTIFACTS = '/opt/cursor/artifacts';
const SCENARIOS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scenarios', 'aircraft');
const SCENARIO_FILES = [
    'p01-straight.json',
    'p01-yaw-right.json',
    'p01-climb.json',
    'p01-combo.json',
];

test.describe('P-01 aircraft scenarios', () => {
    test.setTimeout(600_000);

    for (const file of SCENARIO_FILES) {
        test(file, async ({ page }) => {
            fs.mkdirSync(ARTIFACTS, { recursive: true });
            const scenario = JSON.parse(fs.readFileSync(path.join(SCENARIOS_DIR, file), 'utf8'));

            await enterWorld(page, { tenantId: 'P-01', username: `Scenario-${file}-${Date.now()}` });

            await page.waitForFunction(
                () => globalThis.__tenantAircraftPluginLoaded && window.__tenantE2E?.runAircraftScenario,
                undefined,
                { timeout: 120_000 }
            );

            await page.evaluate(() => {
                window.__tenantE2E.setLocalPosition(211, 1.2, 11);
            });
            await page.waitForTimeout(1200);

            const report = await page.evaluate(
                async (sc) => window.__tenantE2E.runAircraftScenario(sc),
                scenario
            );

            const out = path.join(ARTIFACTS, `e2e-${scenario.id}-report.json`);
            fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);

            if (!report.pass) {
                await fs.promises.writeFile(
                    path.join(ARTIFACTS, `e2e-${scenario.id}-fail.png`),
                    await page.screenshot()
                );
            }

            expect(report.pass, JSON.stringify(report.checkpoints, null, 2)).toBe(true);
        });
    }
});