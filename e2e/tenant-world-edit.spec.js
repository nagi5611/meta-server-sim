// e2e/tenant-world-edit.spec.js
import { test, expect } from '@playwright/test';

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'dev-admin-password-16';

/**
 * CSP / 致命的コンソールを収集する
 * @param {import('@playwright/test').Page} page
 */
function attachConsoleWatchers(page) {
    const lines = [];
    page.on('console', (msg) => {
        lines.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
        lines.push(`[pageerror] ${err}`);
    });
    return lines;
}

test.describe('tenant world edit', () => {
    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('P-01 world editor loads without CSP or module errors', async ({ page }) => {
        const consoleLines = attachConsoleWatchers(page);

        const worldsApi = await page.request.get('/admin/tenants/P-01/worlds');
        expect(worldsApi.ok(), `worlds API status ${worldsApi.status()}`).toBeTruthy();
        const worldsJson = await worldsApi.json();
        expect(Object.keys(worldsJson).length).toBeGreaterThan(0);

        await page.goto('/admin/tenant/P-01/world-edit');

        await expect(page.locator('.admin-sidebar')).toBeVisible();
        await expect(page.locator('.admin-main header')).toBeVisible();
        await expect(page.locator('.we-right-area')).toBeVisible();
        await expect(page.locator('#canvas')).toBeVisible({ timeout: 90_000 });
        await expect(page.locator('#world-list .item').first()).toBeVisible({ timeout: 120_000 });

        const diag = await page.evaluate(() => ({
            itemCount: document.querySelectorAll('#world-list .item').length,
            saveStatus: document.getElementById('save-status')?.textContent?.trim() || '',
            hasAdminFetch: typeof window.adminFetch === 'function',
            shimInstalled: Boolean(window.__tenantAdminWorldEditShimInstalled),
        }));

        expect(
            diag.itemCount,
            `world-list empty (save="${diag.saveStatus}" adminFetch=${diag.hasAdminFetch} shim=${diag.shimInstalled})`
        ).toBeGreaterThan(0);

        const cspViolations = consoleLines.filter(
            (t) =>
                t.includes('Content Security Policy') ||
                t.includes('violates the following Content Security Policy')
        );
        const moduleFailures = consoleLines.filter(
            (t) =>
                t.includes('world-editor.js') ||
                t.includes('flight-board-filter.js') ||
                t.includes('Failed to load module') ||
                t.includes('Failed to fetch dynamically imported module')
        );
        const pageErrors = consoleLines.filter((t) => t.startsWith('[pageerror]'));

        expect(cspViolations, `CSP violations: ${cspViolations.join(' | ')}`).toEqual([]);
        expect(moduleFailures, `module load failures: ${moduleFailures.join(' | ')}`).toEqual([]);
        expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    });
});
