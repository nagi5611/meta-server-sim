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
 * @param {string} view
 */
async function frameCloudAndRender(page, view) {
    return page.evaluate(
        async (v) => {
            const mgr = globalThis.__tenantVdbVolumeManager;
            const app = mgr?.app;
            const renderer = app?.sceneManager?.getRenderer?.();
            if (!mgr || !renderer) throw new Error('vdb volume manager or renderer missing');
            const framed = mgr.frameVolumeForView('cloud-demo', v);
            for (let i = 0; i < 4; i++) {
                mgr.applyCameraLock?.();
                await new Promise((r) => requestAnimationFrame(r));
                renderer.render(app.sceneManager.getScene(), app.sceneManager.getCamera());
            }
            const cloudStats = mgr.sampleCloudRegion('cloud-demo');
            const sample = mgr.sampleCenterPixel();
            return { framed, cloudStats, sample, boxes: globalThis.__tenantVdbVolume?.boxes };
        },
        view,
    );
}

test.describe('vdb-volume addon', () => {
    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('cloud is visibly rendered; angles differ; perf snapshot', async ({ page, request }) => {
        test.setTimeout(300_000);
        fs.mkdirSync(SHOT, { recursive: true });
        fs.mkdirSync(ARTIFACTS, { recursive: true });

        const csrf = await fetchAdminCsrf(request);
        const headers = { 'X-Admin-CSRF': csrf };

        await request.post(`/admin/tenant/${TENANT_ID}/plugins/${PLUGIN_ID}/enable`, { headers });
        await request.post(`/admin/tenant/${TENANT_ID}/plugins/reload`, { headers });

        const user = `VdbE2E-${Date.now()}`;
        await enterWorld(page, { tenantId: TENANT_ID, username: user, waitSocket: false });
        await page.goto(`/${TENANT_ID}/?world=school`, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
            () =>
                document.documentElement.dataset.tenantMetaverseReady === 'true'
                && globalThis.__tenantVdbVolumeManager,
            undefined,
            { timeout: 180_000 },
        );
        await waitForVolumeMeshes(page);

        const front = await frameCloudAndRender(page, 'front');
        expect(front.cloudStats?.brightRatio ?? 0).toBeGreaterThan(0.14);
        expect(front.cloudStats?.samples ?? 0).toBeGreaterThanOrEqual(49);

        await page.screenshot({
            path: path.join(SHOT, 'vdb-cloud-front.png'),
            fullPage: false,
        });
        fs.copyFileSync(
            path.join(SHOT, 'vdb-cloud-front.png'),
            path.join(ARTIFACTS, 'vdb-cloud-front.png'),
        );

        const disabled = await page.evaluate(async () => {
            globalThis.__tenantVdbVolumeManager?.disposeMeshes();
            const app = globalThis.__tenantVdbVolumeManager?.app;
            const mgr = globalThis.__tenantVdbVolumeManager;
            const renderer = app?.sceneManager?.getRenderer?.();
            mgr?.applyCameraLock?.();
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            renderer?.render(app.sceneManager.getScene(), app.sceneManager.getCamera());
            return mgr?.sampleCloudRegion?.('cloud-demo');
        });
        const enabledBright = front.cloudStats?.brightRatio ?? 0;
        const disabledBright = disabled?.brightRatio ?? 0;
        expect(enabledBright - disabledBright).toBeGreaterThan(0.08);

        const angles = ['oblique', 'backlit'];
        const eyes = [front.framed?.eye];
        for (const view of angles) {
            const framed = await frameCloudAndRender(page, view);
            expect(framed.cloudStats?.brightRatio ?? 0).toBeGreaterThan(0.12);
            eyes.push(framed.framed?.eye);
            await page.waitForTimeout(120);
            const shotPath = path.join(SHOT, `vdb-cloud-${view}.png`);
            await page.screenshot({ path: shotPath, fullPage: false });
            fs.copyFileSync(shotPath, path.join(ARTIFACTS, `vdb-cloud-${view}.png`));
        }

        const dist = (a, b) => {
            if (!a || !b) return 0;
            return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
        };
        expect(dist(eyes[0], eyes[1])).toBeGreaterThan(8);
        expect(dist(eyes[0], eyes[2])).toBeGreaterThan(10);
        expect(dist(eyes[1], eyes[2])).toBeGreaterThan(8);

        await page.evaluate(() => globalThis.__tenantVdbVolumeManager?.loadForWorld?.(
            window.__tenantE2E.getMetaverseApp?.().worldManager?.getCurrentWorld?.(),
        ));
        await waitForVolumeMeshes(page);
        await frameCloudAndRender(page, 'front');

        const fps = await page.evaluate(async () => {
            return globalThis.__tenantVdbVolumeManager?.measureFpsWithAndWithoutVolume?.(1200);
        });
        expect(fps?.withVolume).toBeGreaterThan(1);
        expect(fps?.withoutVolume).toBeGreaterThan(fps?.withVolume);
        fs.writeFileSync(
            path.join(ARTIFACTS, 'vdb-cloud-fps.json'),
            JSON.stringify(
                {
                    ...fps,
                    note: 'Headless SwiftShader; withoutVolume はメッシュ non-visible',
                },
                null,
                2,
            ),
        );

        const registryGuards = await page.evaluate(() => ({
            vdbManagers: globalThis.__tenantVdbVolumeManager ? 1 : 0,
            clientInitsDone: document.documentElement.dataset.tenantMetaverseReady === 'true',
        }));
        expect(registryGuards.vdbManagers).toBe(1);
        expect(registryGuards.clientInitsDone).toBe(true);
    });
});