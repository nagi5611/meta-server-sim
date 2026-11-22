// e2e/share-url-join-production.spec.js — m.mmh-virtual.jp 共有 URL（本番スモーク）
import { test, expect } from '@playwright/test';
import path from 'node:path';

const LOBBY_ORIGIN = process.env.E2E_LOBBY_ORIGIN || 'https://m.mmh-virtual.jp';
const JOIN_TENANT = process.env.E2E_SHARE_JOIN_TENANT || 'P-01';

test.describe('share join production smoke', () => {
    test('lobby card menu copies share URL and join page loads', async ({ page, context }) => {
        await context.grantPermissions(['clipboard-read', 'clipboard-write']);
        await page.goto(`${LOBBY_ORIGIN}/`, { waitUntil: 'domcontentloaded' });

        const firstMenuBtn = page.locator('.card-menu-btn').first();
        await expect(firstMenuBtn).toBeVisible({ timeout: 30_000 });
        await firstMenuBtn.click();

        const copyItem = page.locator('[data-share-action="copy"]').first();
        await expect(copyItem).toBeVisible();
        await copyItem.click();

        await expect(page.locator('#toast.on')).toBeVisible({ timeout: 5000 });

        const joinUrl = `${LOBBY_ORIGIN}/join/${JOIN_TENANT}`;
        await page.goto(joinUrl, { waitUntil: 'domcontentloaded' });

        await expect(page.locator('#joinCard, #joinNotFound, #joinMaint').first()).toBeVisible({
            timeout: 20_000,
        });

        const screenshotPath = path.join('/opt/cursor/artifacts', 'share-join-page-production.png');
        await page.screenshot({ path: screenshotPath, fullPage: true });
    });
});