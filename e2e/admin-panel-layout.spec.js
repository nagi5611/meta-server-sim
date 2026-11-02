// e2e/admin-panel-layout.spec.js — platform admin settings layout (sim + staging)
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || process.env.SIM_ADMIN_PASSWORD || '';

const ARTIFACT_DIR = path.join(process.cwd(), 'test-results', 'admin-layout');

async function assertSettingsSubnav(page) {
    const subnav = page.locator('#admin-settings-subnav');
    await expect(subnav).toBeVisible();
    const box = await subnav.boundingBox();
    expect(box).toBeTruthy();
    if (box) {
        expect(box.width).toBeGreaterThan(200);
        expect(box.height).toBeGreaterThan(32);
        expect(box.height).toBeLessThan(120);
    }
    const flex = await subnav.evaluate((el) => getComputedStyle(el).display);
    expect(flex).toBe('flex');
}

async function assertSectionHeaderRow(page, sectionSelector) {
    const row = page.locator(`${sectionSelector} .section-header-row`).first();
    await expect(row).toBeVisible();
    const layout = await row.evaluate((el) => {
        const s = getComputedStyle(el);
        return { display: s.display, flexDirection: s.flexDirection, justifyContent: s.justifyContent };
    });
    expect(layout.display).toBe('flex');
    expect(layout.flexDirection).toBe('row');
    expect(layout.justifyContent).toMatch(/space-between|flex-start/);
}

async function openAdminSettings(page, settingsTab = 'env') {
    await page.goto(`/admin.html#settings/${settingsTab}`, { waitUntil: 'networkidle' });
    await expect(page.locator('.admin-sidebar')).toBeVisible({ timeout: 30_000 });
    await expect(page.locator('#env-config-save-btn, #network-config-save-btn')).toBeVisible({
        timeout: 30_000,
    });
    const settingsPanel = page.locator('.admin-panel[data-admin-panel-id="settings"]');
    await expect(settingsPanel).toHaveClass(/active/, { timeout: 15_000 });
}

test.describe('admin panel layout', () => {
    test.skip(!ADMIN_PASS, 'Set ADMIN_PASSWORD or SIM_ADMIN_PASSWORD for production admin e2e');

    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('settings subnav and env/network sections layout', async ({ page, baseURL }) => {
        fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
        const host = new URL(baseURL || 'http://localhost:3003').hostname;

        await openAdminSettings(page, 'env');
        await assertSettingsSubnav(page);
        await page.screenshot({
            path: path.join(ARTIFACT_DIR, `${host}-settings-env.png`),
            fullPage: true,
        });

        await assertSectionHeaderRow(page, '.env-config-section');
        const envSave = page.locator('#env-config-save-btn');
        await expect(envSave).toBeVisible();
        const envSaveBox = await envSave.boundingBox();
        const envHeader = await page.locator('.env-config-section .section-header-row h2').boundingBox();
        expect(envSaveBox && envHeader).toBeTruthy();
        if (envSaveBox && envHeader) {
            expect(envSaveBox.y).toBeLessThan(envHeader.y + envHeader.height + 8);
        }

        await page.locator('[data-settings-tab="network"]').click();
        await expect(page.locator('.admin-settings-tab[data-settings-tab-id="network"].active')).toBeVisible();
        await assertSettingsSubnav(page);
        await assertSectionHeaderRow(page, '.network-config-section');
        await page.screenshot({
            path: path.join(ARTIFACT_DIR, `${host}-settings-network.png`),
            fullPage: true,
        });

        const networkSave = page.locator('#network-config-save-btn');
        const addServer = page.locator('#network-server-add-btn');
        await expect(networkSave).toBeVisible();
        await expect(addServer).toBeVisible();
        const addBox = await addServer.boundingBox();
        expect(addBox?.width).toBeGreaterThan(40);
    });
});
