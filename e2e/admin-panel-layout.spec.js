// e2e/admin-panel-layout.spec.js — platform admin settings layout (sim + staging)
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || process.env.SIM_ADMIN_PASSWORD || '';

const ARTIFACT_DIR = path.join(process.cwd(), 'test-results', 'admin-layout');

async function assertSettingsSubnav(page) {
    const subnav = page.locator('[data-ps-tabs]');
    await expect(subnav).toBeVisible();
    const flex = await subnav.evaluate((el) => getComputedStyle(el).display);
    expect(flex).toMatch(/flex|inline-flex/);
}

async function openAdminSettings(page, settingsTab = 'env') {
    await page.goto(`/admin.html#settings/${settingsTab}`, { waitUntil: 'networkidle' });
    await expect(page.locator('#app')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.side')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('#platformSettingsBody, .sheet .head h1')).toContainText(/設定/, {
        timeout: 30_000,
    });
    await expect(page.locator('[data-ps-tabs]')).toBeVisible();
}

test.describe('admin panel layout', () => {
    test.skip(!ADMIN_PASS, 'Set ADMIN_PASSWORD or SIM_ADMIN_PASSWORD for production admin e2e');

    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('CONSOLE design settings tabs and platform shell layout', async ({ page, baseURL }) => {
        fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
        const host = new URL(baseURL || 'http://localhost:3003').hostname;

        await openAdminSettings(page, 'env');
        await assertSettingsSubnav(page);
        await expect(page.locator('#platformSettingsBody .tbl, #platformSettingsBody .hint')).toBeVisible();
        await page.screenshot({
            path: path.join(ARTIFACT_DIR, `${host}-settings-env.png`),
            fullPage: true,
        });

        await page.locator('[data-ps-tab="network"]').click();
        await expect(page.locator('[data-ps-tab="network"]')).toHaveClass(/on/);
        await expect(page.locator('#platformSettingsBody')).toBeVisible();
        await page.screenshot({
            path: path.join(ARTIFACT_DIR, `${host}-settings-network.png`),
            fullPage: true,
        });
    });
});
