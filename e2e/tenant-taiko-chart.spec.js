// e2e/tenant-taiko-chart.spec.js
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { enableTenantE2EHarness } from './helpers/tenant-metaverse.mjs';

test.describe('tenant taiko chart UI', () => {
    test('meta-server opens song select and lists charts', async ({ page }) => {
        await enableTenantE2EHarness(page);
        await page.goto('/meta-server/');

        const controlOverlay = page.locator('#control-scheme-keyboard-btn');
        if (await controlOverlay.isVisible({ timeout: 3000 }).catch(() => false)) {
            await controlOverlay.click();
        }

        await expect
            .poll(async () => page.locator('html').getAttribute('data-tenant-metaverse-ready'), {
                timeout: 90_000,
            })
            .toBe('true');

        const chartEnabled = await page.evaluate(() => window.__tenantE2E?.getChartFeaturesEnabled?.());
        test.skip(!chartEnabled, 'chartFeaturesEnabled がオフ（ENABLE_CHART_FEATURES / tenant.json）');

        await page.evaluate(() => window.__tenantE2E.openTaikoSongSelect());
        const overlay = page.locator('#taiko-game-overlay');
        await expect(overlay).toBeVisible({ timeout: 10_000 });

        await expect
            .poll(async () => page.locator('#taiko-chart-list li').count(), { timeout: 15_000 })
            .toBeGreaterThan(0);

        const art = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts';
        await page.screenshot({
            path: `${art}/tenant-taiko-song-select-live.png`,
            fullPage: true,
        });
    });

    test('meta-server E key near taiko → play demo → score POST', async ({ page }) => {
        const base = process.env.E2E_BASE_URL || 'http://localhost:3003';

        await enableTenantE2EHarness(page);
        const scoreWait = page.waitForResponse(
            (res) =>
                res.request().method() === 'POST' &&
                /\/api\/charts\/[^/]+\/score/.test(res.url()),
            { timeout: 120_000 }
        );

        await page.goto(`${base.replace(/\/$/, '')}/meta-server/`);

        if (await page.locator('#control-scheme-keyboard-btn').isVisible({ timeout: 3000 }).catch(() => false)) {
            await page.locator('#control-scheme-keyboard-btn').click();
        }

        await expect
            .poll(async () => page.locator('html').getAttribute('data-tenant-metaverse-ready'), {
                timeout: 120_000,
            })
            .toBe('true');

        const chartEnabled = await page.evaluate(() => window.__tenantE2E?.getChartFeaturesEnabled?.());
        test.skip(!chartEnabled, 'chartFeaturesEnabled がオフ');

        await page.evaluate(() => {
            const app = window.__tenantE2E?.getMetaverseApp?.();
            if (!app?.characterController) throw new Error('app not ready');
            app.characterController.setPosition(9.22, 10.51, 4.63);
            app.updateTaikoZones?.();
            const feet = app.characterController.getPosition();
            if (feet) app.teleportManager?.updateProximity?.(feet);
        });

        await page.keyboard.press('KeyE');
        await expect(page.locator('#taiko-game-overlay')).toBeVisible({ timeout: 15_000 });

        const demoItem = page.locator('#taiko-chart-list li').first();
        await expect(demoItem).toBeVisible({ timeout: 20_000 });
        await demoItem.click();
        await expect(page.locator('#taiko-game-container')).toBeVisible({ timeout: 15_000 });

        await page.evaluate(async () => {
            const mgr = window.__tenantE2E?.getMetaverseApp?.()?.taikoGameManager;
            if (!mgr) throw new Error('taikoGameManager missing');
            mgr._chartMeta = { id: 'demo', name: 'demo', difficulty: 1 };
            mgr._score = 100;
            mgr._maxScore = 100;
            await mgr._onSongEnd();
        });

        await scoreWait;
        const art2 = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts';
        await fs.writeFile(
            `${art2}/staging-meta-server-taiko.url.txt`,
            `${base.replace(/\/$/, '')}/meta-server/\n`
        ).catch(() => {});
        await page.screenshot({
            path: `${art2}/tenant-taiko-score-post.png`,
            fullPage: true,
        });
    });
});