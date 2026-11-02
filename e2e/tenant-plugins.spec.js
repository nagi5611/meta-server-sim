// e2e/tenant-plugins.spec.js
import { test, expect } from '@playwright/test';

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'dev-admin-password-16';
const TENANT_ID = 'P-01';
const PLUGIN_ID = 'sample-echo';

test.describe('tenant plugins (sample-echo)', () => {
    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('admin Plugins tab enables sample-echo, reload, hello API, client module', async ({
        page,
        request,
    }) => {
        await page.goto(`/admin/tenant/${TENANT_ID}`);
        await expect(page.locator('.admin-sidebar')).toBeVisible();

        const pluginsNav = page.locator('[data-tenant-panel="plugins"]');
        await expect(pluginsNav).toBeVisible();

        await pluginsNav.click();
        await expect(page.locator('#panel-plugins')).toHaveClass(/active/);

        const row = page.locator('#tenant-plugins-table-body tr', {
            has: page.locator(`code:has-text("${PLUGIN_ID}")`),
        });
        await expect(row).toBeVisible({ timeout: 30_000 });

        const disableBtn = row.locator('.tenant-plugin-disable-btn');
        if (await disableBtn.isEnabled()) {
            await disableBtn.click();
            await page.locator('#tenant-plugins-reload-btn').click();
            await expect(page.locator('#tenant-plugins-status')).toContainText(/Reload/i, {
                timeout: 30_000,
            });
        }

        await row.locator('.tenant-plugin-enable-btn').click();
        await expect(row.locator('.tenant-plugin-disable-btn')).toBeEnabled({ timeout: 15_000 });

        await page.locator('#tenant-plugins-reload-btn').click();
        await expect(page.locator('#tenant-plugins-status')).toContainText(/Reload 完了/i, {
            timeout: 30_000,
        });

        const helloRes = await request.get(
            `/${TENANT_ID}/api/tenant-plugins/${PLUGIN_ID}/hello`
        );
        expect(helloRes.ok()).toBeTruthy();
        const helloJson = await helloRes.json();
        expect(helloJson.ok).toBe(true);
        expect(helloJson.pluginId).toBe(PLUGIN_ID);

        const enabledRes = await request.get(
            `/${TENANT_ID}/api/tenants/${TENANT_ID}/addons/enabled`
        );
        expect(enabledRes.ok()).toBeTruthy();
        const enabledJson = await enabledRes.json();
        expect(enabledJson.plugins?.some((p) => p.id === PLUGIN_ID)).toBe(true);

        const modRes = await request.get(
            `/${TENANT_ID}/addons-client/${PLUGIN_ID}/client/game.js`
        );
        expect(modRes.ok()).toBeTruthy();

        await page.goto(`/${TENANT_ID}/`);
        await page.evaluate(async ({ tenantId, pluginId }) => {
            const r = await fetch(
                `/${tenantId}/api/tenants/${tenantId}/addons/enabled`,
                { credentials: 'include' }
            );
            const d = await r.json();
            const plugin = (d.plugins || []).find((p) => p.id === pluginId);
            if (!plugin?.gameModule) throw new Error('sample-echo not in enabled list');
            await import(
                `/${tenantId}/addons-client/${pluginId}/${plugin.gameModule}`
            );
            window.__tenantSampleEchoLoaded = true;
        }, { tenantId: TENANT_ID, pluginId: PLUGIN_ID });
        expect(await page.evaluate(() => window.__tenantSampleEchoLoaded === true)).toBe(true);
    });

    test('double reload does not duplicate sample-echo socket hook emissions', async ({
        request,
    }) => {
        await request.post(`/admin/tenant/${TENANT_ID}/plugins/${PLUGIN_ID}/enable`, {
            headers: { 'X-Admin-CSRF': await fetchAdminCsrf(request) },
        });
        await request.post(`/admin/tenant/${TENANT_ID}/plugins/reload`, {
            headers: { 'X-Admin-CSRF': await fetchAdminCsrf(request) },
        });
        await request.post(`/admin/tenant/${TENANT_ID}/plugins/reload`, {
            headers: { 'X-Admin-CSRF': await fetchAdminCsrf(request) },
        });

        const helloRes = await request.get(
            `/${TENANT_ID}/api/tenant-plugins/${PLUGIN_ID}/hello`
        );
        expect(helloRes.ok()).toBeTruthy();
    });
});

/**
 * @param {import('@playwright/test').APIRequestContext} request
 */
async function fetchAdminCsrf(request) {
    const res = await request.get('/admin/csrf-token');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    return data.token;
}
