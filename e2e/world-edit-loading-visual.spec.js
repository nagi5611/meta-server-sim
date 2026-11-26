// e2e/world-edit-loading-visual.spec.js — 円形カードローディングのビジュアル検証
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { attachStagingSimForwardHeaders } from './helpers/admin-basic-auth.mjs';

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'dev-admin-password-16';
const ARTIFACT_DIR = process.env.WORLD_LOADING_ARTIFACT_DIR || '/opt/cursor/artifacts/world-edit-loading';

test.describe('world edit loading overlay visuals', () => {
    test.use({
        viewport: { width: 1440, height: 900 },
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('captures loading, complete, and editor states', async ({ page }) => {
        fs.mkdirSync(ARTIFACT_DIR, { recursive: true });
        await attachStagingSimForwardHeaders(page);

        const appReady = () =>
            page.waitForFunction(
                () => document.getElementById('app') && !document.getElementById('app').hidden,
                null,
                { timeout: 120_000 }
            );

        await page.goto('/admin/tenant/P-01/world-edit', { waitUntil: 'commit' });
        await appReady();

        const overlay = page.locator('.mt-world-loading');
        await expect(overlay).toBeAttached({ timeout: 120_000 });

        let capturedProgress = false;
        for (let i = 0; i < 80; i += 1) {
            const hidden = await overlay.getAttribute('hidden');
            const pill = await page.locator('.mt-world-loading .d-pill').textContent().catch(() => '');
            const hasBar = (await page.locator('.mt-world-loading.ld-bar-step-3, .mt-world-loading.ld-bar-step-4, .mt-world-loading.ld-bar-step-5').count()) > 0;
            if (!hidden && pill && pill.includes('STEP') && hasBar) {
                await page.screenshot({
                    path: path.join(ARTIFACT_DIR, '01-loading-in-progress.png'),
                    fullPage: false,
                });
                capturedProgress = true;
                break;
            }
            await page.waitForTimeout(80);
        }
        expect(capturedProgress, 'loading in-progress overlay').toBeTruthy();

        await expect(page.locator('.mt-world-loading .d-ok')).toBeVisible({ timeout: 180_000 });
        await expect(page.locator('.mt-world-loading .d-t')).toContainText(/を開きました/, { timeout: 30_000 });
        await page.screenshot({
            path: path.join(ARTIFACT_DIR, '02-loading-complete.png'),
            fullPage: false,
        });

        await expect(overlay).toBeHidden({ timeout: 60_000 });
        await page.waitForFunction(
            () => {
                const root = document.querySelector('.wed-root');
                const canvas = root?.querySelector('[data-canvas] canvas');
                return canvas && canvas.getBoundingClientRect().width > 64 && !window.MT?.state?.ed?.loading;
            },
            null,
            { timeout: 180_000 }
        );
        await page.waitForTimeout(400);
        await page.screenshot({
            path: path.join(ARTIFACT_DIR, '03-editor-ready.png'),
            fullPage: false,
        });
    });
});