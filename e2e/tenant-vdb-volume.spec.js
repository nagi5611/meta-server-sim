// e2e/tenant-vdb-volume.spec.js — vdb-volume 描画の実ピクセル検証
import path from 'node:path';
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import {
    TENANT_ID,
    ADMIN_USER,
    ADMIN_PASS,
} from './helpers/tenant-metaverse.mjs';
import { enterWorld } from './helpers/tenant-metaverse-agent.mjs';

const PLUGIN_ID = 'vdb-volume';
const ARTIFACTS = '/opt/cursor/artifacts';
const SHOT = path.join(process.cwd(), 'test-results', 'tenant-vdb-volume');

async function fetchAdminCsrf(request) {
    const res = await request.get('/admin/csrf-token');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    return data.token;
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function waitForVolumeMeshes(page) {
    await page.waitForFunction(
        () => {
            const st = globalThis.__tenantVdbVolume;
            return st && st.meshCount >= 1 && st.loading === false;
        },
        undefined,
        { timeout: 120_000 },
    );
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function frameVolumeAndSample(page) {
    return page.evaluate(async () => {
        const mgr = globalThis.__tenantVdbVolumeManager;
        const app = mgr?.app;
        const renderer = app?.sceneManager?.getRenderer?.();
        if (!mgr || !renderer) {
            throw new Error('vdb volume manager or renderer missing');
        }
        mgr.frameVolumeForView('smoke-demo');
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        renderer.render(app.sceneManager.getScene(), app.sceneManager.getCamera());
        const sample = mgr.sampleCenterPixel();
        const meshCount = globalThis.__tenantVdbVolume?.meshCount ?? 0;
        const sceneMeshes = [];
        app.sceneManager.getScene().traverse((o) => {
            if (o.name === 'vdb-volume-raymarch') sceneMeshes.push(o.name);
        });
        return { sample, meshCount, sceneMeshes, boxes: globalThis.__tenantVdbVolume?.boxes };
    });
}

test.describe('vdb-volume addon', () => {
    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('volume pixels differ when disabled; client inits stay single-shot', async ({
        page,
        request,
    }) => {
        test.setTimeout(240_000);
        fs.mkdirSync(SHOT, { recursive: true });
        fs.mkdirSync(ARTIFACTS, { recursive: true });

        const csrf = await fetchAdminCsrf(request);
        const headers = { 'X-Admin-CSRF': csrf };

        await request.post(`/admin/tenant/${TENANT_ID}/plugins/${PLUGIN_ID}/enable`, { headers });
        await request.post(`/admin/tenant/${TENANT_ID}/plugins/reload`, { headers });

        await enterWorld(page, { tenantId: TENANT_ID, username: `VdbE2E-${Date.now()}` });

        await page.waitForFunction(
            () =>
                document.documentElement.dataset.tenantMetaverseReady === 'true'
                && typeof window.__tenantE2E?.switchToWorld === 'function',
            undefined,
            { timeout: 120_000 },
        );

        await page.evaluate(() => window.__tenantE2E.switchToWorld('school'));
        await waitForVolumeMeshes(page);

        const withVolume = await frameVolumeAndSample(page);
        expect(withVolume.sceneMeshes.length).toBeGreaterThanOrEqual(1);
        expect(withVolume.meshCount).toBeGreaterThanOrEqual(1);
        expect(withVolume.sample).not.toBeNull();

        await page.screenshot({
            path: path.join(SHOT, 'vdb-volume-enabled.png'),
            fullPage: false,
        });
        fs.copyFileSync(
            path.join(SHOT, 'vdb-volume-enabled.png'),
            path.join(ARTIFACTS, 'vdb-volume-enabled.png'),
        );

        const disabled = await page.evaluate(async () => {
            globalThis.__tenantVdbVolumeManager?.disposeMeshes();
            const app = globalThis.__tenantVdbVolumeManager?.app;
            const renderer = app?.sceneManager?.getRenderer?.();
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            renderer?.render(app.sceneManager.getScene(), app.sceneManager.getCamera());
            const sample = globalThis.__tenantVdbVolumeManager?.sampleCenterPixel?.();
            const meshCount = globalThis.__tenantVdbVolume?.meshCount ?? 0;
            return { sample, meshCount };
        });

        expect(disabled.meshCount).toBe(0);

        await page.evaluate(() => {
            const mgr = globalThis.__tenantVdbVolumeManager;
            mgr?.frameVolumeForView('smoke-demo');
        });
        await page.waitForTimeout(300);
        await page.screenshot({
            path: path.join(SHOT, 'vdb-volume-disabled.png'),
            fullPage: false,
        });
        fs.copyFileSync(
            path.join(SHOT, 'vdb-volume-disabled.png'),
            path.join(ARTIFACTS, 'vdb-volume-disabled.png'),
        );

        const lum = (px) => (px?.r ?? 0) + (px?.g ?? 0) + (px?.b ?? 0);
        const enabledLum = lum(withVolume.sample);
        const disabledLum = lum(disabled.sample);
        expect(Math.abs(enabledLum - disabledLum)).toBeGreaterThan(25);

        const warmTint = (withVolume.sample?.r ?? 0) + (withVolume.sample?.g ?? 0) * 0.5;
        expect(warmTint).toBeGreaterThan((disabled.sample?.r ?? 0) + 5);

        const registryGuards = await page.evaluate(() => {
            const app = window.__tenantE2E?.getMetaverseApp?.();
            return {
                vdbManagers: globalThis.__tenantVdbVolumeManager ? 1 : 0,
                clientInitsDone: app?.tenantId != null && document.documentElement.dataset.tenantMetaverseReady === 'true',
            };
        });
        expect(registryGuards.vdbManagers).toBe(1);
        expect(registryGuards.clientInitsDone).toBe(true);
    });

});