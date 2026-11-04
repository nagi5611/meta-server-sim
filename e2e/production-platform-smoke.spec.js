// e2e/production-platform-smoke.spec.js — sim.mmh-virtual.jp deploy smoke (no localhost ports)
import { test, expect } from '@playwright/test';

const TENANT_ID = process.env.E2E_TENANT_ID || 'P-01';

test.describe('production platform smoke', () => {
    test('API health and tenant client-config', async ({ request }) => {
        const health = await request.get('/api/health');
        expect(health.ok()).toBeTruthy();
        const h = await health.json();
        expect(h.ok).toBe(true);

        const cfg = await request.get(`/${TENANT_ID}/api/client-config`);
        expect(cfg.ok()).toBeTruthy();
    });

    test('admin.html loads settings nav', async ({ page }) => {
        await page.goto('/admin.html');
        await expect(page.locator('#env-config-groups, .env-config-section')).toBeVisible({
            timeout: 30_000,
        });
        await expect(page.locator('[data-settings-panel="fleet"]')).toBeVisible();
    });

    test('tenant metaverse ready on production URL', async ({ page }) => {
        await page.addInitScript(() => {
            window.__TENANT_E2E_HARNESS__ = '1';
            localStorage.setItem('metaverseGuestName:P-01', 'ProdSmoke');
        });
        await page.goto(`/${TENANT_ID}/`);
        await expect
            .poll(async () => page.evaluate(() => document.documentElement.dataset.tenantMetaverseReady))
            .toBe('true');
    });
});
