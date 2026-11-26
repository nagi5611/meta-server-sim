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

        const completeReady = page.waitForFunction(
            () => {
                const root = document.querySelector('.mt-world-loading:not([hidden])');
                if (!root || root.classList.contains('is-dismissing')) return false;
                if (root.dataset.mtLdPhase !== 'complete') return false;
                const stage = document.querySelector('.mt-world-loading .ld-stage.is-collapsed');
                const okEl = document.querySelector('.mt-world-loading .d-ok');
                const title = document.querySelector('.mt-world-loading .d-t');
                return !!(
                    stage &&
                    okEl &&
                    title &&
                    okEl.textContent.includes('読み込み完了') &&
                    title.textContent.includes('を開きました')
                );
            },
            null,
            { timeout: 180_000, polling: 'raf' }
        );

        await page.goto('/admin/tenant/P-01/world-edit', { waitUntil: 'commit' });
        await expect(page.locator('.mt-world-loading')).toBeAttached({ timeout: 120_000 });

        let capturedProgress = false;
        for (let i = 0; i < 400; i += 1) {
            if (!capturedProgress) {
                const progressOk = await page.evaluate(() => {
                    const root = document.querySelector('.mt-world-loading:not([hidden])');
                    const pill = document.querySelector('.mt-world-loading .d-pill');
                    const title = document.querySelector('.mt-world-loading .d-t');
                    if (!root || !pill || !title) return false;
                    const step = Number(root.dataset.mtLdStep || 0);
                    if (step < 4) return false;
                    return (
                        pill.textContent.includes('STEP') &&
                        title.textContent.length > 3 &&
                        parseFloat(getComputedStyle(pill).opacity) > 0.85 &&
                        parseFloat(getComputedStyle(title).opacity) > 0.85
                    );
                });
                if (progressOk) {
                    await page.waitForTimeout(400);
                    await expect(page.locator('.mt-world-loading .d-pill')).toBeVisible();
                    await expect(page.locator('.mt-world-loading .d-t')).toBeVisible();
                    await page.screenshot({
                        path: path.join(ARTIFACT_DIR, '01-loading-in-progress.png'),
                        fullPage: false,
                        animations: 'disabled',
                    });
                    capturedProgress = true;
                }
            }
            if (capturedProgress) break;
            await page.waitForTimeout(40);
        }
        expect(capturedProgress, 'loading in-progress overlay').toBeTruthy();

        await completeReady;
        await expect(page.locator('.mt-world-loading .ld-stage.is-collapsed')).toBeVisible();
        await expect(page.locator('.mt-world-loading .d-ok')).toContainText('読み込み完了');
        await page.screenshot({
            path: path.join(ARTIFACT_DIR, '02-loading-complete.png'),
            fullPage: false,
        });

        await page.waitForFunction(
            () => document.querySelector('.mt-world-loading[hidden]') !== null,
            null,
            { timeout: 180_000 }
        );

        await page.waitForFunction(
            () => {
                const root = document.querySelector('.wed-root');
                const canvas = root?.querySelector('[data-canvas] canvas');
                return canvas && canvas.getBoundingClientRect().width > 64 && !window.MT?.state?.ed?.loading;
            },
            null,
            { timeout: 180_000 }
        );
        await page.mouse.move(720, 480);
        await page.waitForTimeout(350);
        const railWidth = await page.locator('.side.rail').evaluate((el) => el.getBoundingClientRect().width);
        expect(railWidth, 'collapsed editor rail width').toBeLessThan(56);
        await page.screenshot({
            path: path.join(ARTIFACT_DIR, '03-editor-ready.png'),
            fullPage: false,
        });
    });
});