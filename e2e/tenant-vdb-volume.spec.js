// e2e/tenant-vdb-volume.spec.js — vdb-volume アドオン描画スモーク
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
    TENANT_ID,
    ADMIN_USER,
    ADMIN_PASS,
} from './helpers/tenant-metaverse.mjs';
import { enterWorld } from './helpers/tenant-metaverse-agent.mjs';

const PLUGIN_ID = 'vdb-volume';
const SHOT = path.join(process.cwd(), 'test-results', 'tenant-vdb-volume');

async function fetchAdminCsrf(request) {
    const res = await request.get('/admin/csrf-token');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    return data.token;
}

test.describe('vdb-volume addon', () => {
    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('loads NanoVDB smoke in school world', async ({ page, request }) => {
        test.setTimeout(180_000);
        const csrf = await fetchAdminCsrf(request);
        const headers = { 'X-Admin-CSRF': csrf };

        await request.post(`/admin/tenant/${TENANT_ID}/plugins/${PLUGIN_ID}/enable`, { headers });
        await request.post(`/admin/tenant/${TENANT_ID}/plugins/reload`, { headers });

        const enabledRes = await request.get(`/${TENANT_ID}/api/tenants/${TENANT_ID}/addons/enabled`);
        const enabledJson = await enabledRes.json();
        expect(enabledJson.plugins?.some((p) => p.id === PLUGIN_ID)).toBe(true);

        await enterWorld(page, { tenantId: TENANT_ID, username: `VdbE2E-${Date.now()}` });

        await page.waitForFunction(
            () =>
                document.documentElement.dataset.tenantMetaverseReady === 'true'
                && typeof window.__tenantE2E?.switchToWorld === 'function',
            undefined,
            { timeout: 120_000 },
        );

        await page.evaluate(() => window.__tenantE2E.switchToWorld('school'));

        await page.waitForFunction(
            () => {
                const st = globalThis.__tenantVdbVolume;
                return st && st.meshCount >= 1 && st.loading === false;
            },
            undefined,
            { timeout: 120_000 },
        );

        const state = await page.evaluate(() => globalThis.__tenantVdbVolume);
        expect(state.meshCount).toBeGreaterThanOrEqual(1);
        expect(state.ids).toContain('smoke-demo');

        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(SHOT, 'vdb-volume-school.png'), fullPage: false });

        const canvas = page.locator('canvas').first();
        await expect(canvas).toBeVisible();
    });
});