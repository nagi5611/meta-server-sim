// e2e/production-tenant-importmap-smoke.spec.js — 本番全テナント入場・コンソール診断（データ変更なし）
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';

const SIM_ORIGIN = (process.env.SIM_ORIGIN || 'https://sim.mmh-virtual.jp').replace(/\/$/, '');
const TENANT_IDS = (process.env.TENANT_IDS || 'P-01,P-02,P-03,meta-server')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
const ARTIFACT_DIR = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts';

const CONSOLE_PATTERNS = [
    /import map/i,
    /Failed to resolve module specifier/i,
    /three-mesh-ui/i,
    /Multiple instances of Three\.js/i,
    /\[tenant-plugins\] client load failed/i,
];

test.describe('production tenant importmap smoke', () => {
    for (const tenantId of TENANT_IDS) {
        test(`${tenantId} entry UI and console`, async ({ page }) => {
            const consoleLines = [];
            page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));
            page.on('pageerror', (err) => consoleLines.push(`[pageerror] ${err}`));

            await page.addInitScript(() => {
                window.__TENANT_E2E_HARNESS__ = '1';
                document.documentElement.dataset.e2eHarness = '1';
                try {
                    localStorage.setItem('metaverse-control-scheme', 'keyboard');
                    localStorage.setItem('username', `E2E-${Date.now()}`);
                } catch {
                    /* ignore */
                }
            });

            const entryUrl = `${SIM_ORIGIN}/${encodeURIComponent(tenantId)}/`;
            const res = await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
            expect(res?.status() ?? 0).toBeLessThan(400);

            const gate = page.locator('#tenant-login-enter-btn');
            if (await gate.isVisible({ timeout: 5000 }).catch(() => false)) {
                await gate.click();
            }

            const kb = page.locator('#control-scheme-keyboard-btn');
            if (await kb.isVisible({ timeout: 3000 }).catch(() => false)) {
                await kb.click();
            }

            await expect(page.locator('#canvas')).toBeVisible({ timeout: 90_000 });
            await expect
                .poll(
                    async () => page.evaluate(() => document.documentElement.dataset.tenantMetaverseReady === 'true'),
                    { timeout: 90_000 },
                )
                .toBe(true);

            fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
            await page.screenshot({
                path: path.join(ARTIFACT_DIR, `prod-tenant-smoke-${tenantId}.png`),
                fullPage: true,
            });

            const flagged = consoleLines.filter((line) => CONSOLE_PATTERNS.some((re) => re.test(line)));
            expect(
                flagged,
                `console issues for ${tenantId}:\n${flagged.slice(0, 15).join('\n')}`,
            ).toEqual([]);
        });
    }
});