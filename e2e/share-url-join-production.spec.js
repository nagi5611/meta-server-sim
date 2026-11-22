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

        const copyItem = page.locator('.card-menu [data-share-action="copy"]').first();
        await expect(copyItem).toBeVisible();
        await expect(copyItem).toHaveText(/共有URL|Copy share|共享/);
        await page.screenshot({
            path: path.join('/opt/cursor/artifacts', 'share-join-dropdown-open.png'),
            fullPage: false,
        });

        await copyItem.click();

        await expect(page.locator('#toast.on')).toBeVisible({ timeout: 5000 });

        const joinUrl = `${LOBBY_ORIGIN}/join/${JOIN_TENANT}`;
        const clipboardText = await page.evaluate(async () => navigator.clipboard.readText());
        expect(clipboardText).toBe(joinUrl);

        const fs = await import('node:fs');
        fs.writeFileSync(
            path.join('/opt/cursor/artifacts', 'share-join-copied-url.txt'),
            `${clipboardText}\n`,
            'utf8',
        );

        await page.goto(joinUrl, { waitUntil: 'networkidle' });

        await expect(page.locator('#joinCard:not([hidden])')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#joinWorldName')).not.toBeEmpty();

        await page.screenshot({
            path: path.join('/opt/cursor/artifacts', 'share-join-page-production.png'),
            fullPage: true,
        });
    });
});