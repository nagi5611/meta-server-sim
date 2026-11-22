// e2e/tenant-taiko-chart.spec.js
import { test, expect } from '@playwright/test';
import { enableTenantE2EHarness } from './helpers/tenant-metaverse.mjs';

test.describe('tenant taiko chart UI', () => {
    test('meta-server opens song select and lists charts', async ({ page }) => {
        await enableTenantE2EHarness(page);
        await page.goto('http://localhost:3003/meta-server/');

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

        await page.screenshot({
            path: '/opt/cursor/artifacts/tenant-taiko-song-select.png',
            fullPage: true,
        });
    });
});