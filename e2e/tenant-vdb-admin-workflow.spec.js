// e2e/tenant-vdb-admin-workflow.spec.js — VDB アップロード→設置→表示
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
    TENANT_ID,
    ADMIN_USER,
    ADMIN_PASS,
} from './helpers/tenant-metaverse.mjs';
import {
    installTenantE2EHarness,
    setGuestUsername,
    expectMetaverseReady,
} from './helpers/tenant-metaverse.mjs';

const PLUGIN_ID = 'vdb-volume';
const ARTIFACTS = '/opt/cursor/artifacts';
const SAMPLE_NVDB = path.join(
    process.cwd(),
    'addons/vdb-volume/samples/cloud-cumulus.nvdb',
);

async function fetchAdminCsrf(request) {
    const res = await request.get('/admin/csrf-token');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    return data.token;
}

test.describe('vdb admin workflow', () => {
    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('upload vdb, place in world, render cloud', async ({ page, context, request }) => {
        test.setTimeout(360_000);
        fs.mkdirSync(ARTIFACTS, { recursive: true });

        const csrf = await fetchAdminCsrf(request);
        const headers = { 'X-Admin-CSRF': csrf };

        await request.post(`/admin/tenant/${TENANT_ID}/plugins/${PLUGIN_ID}/enable`, { headers });
        await request.post(`/admin/tenant/${TENANT_ID}/plugins/reload`, { headers });

        const testFileName = `e2e-cloud-${Date.now()}.nvdb`;
        const body = fs.readFileSync(SAMPLE_NVDB);
        const uploadRes = await request.post(
            `/admin/tenants/${TENANT_ID}/upload-vdb?confirm=1`,
            {
                headers: { 'X-Admin-CSRF': csrf },
                multipart: {
                    vdb: {
                        name: testFileName,
                        mimeType: 'application/octet-stream',
                        buffer: body,
                    },
                },
            },
        );
        expect(uploadRes.ok(), await uploadRes.text()).toBeTruthy();
        const uploaded = await uploadRes.json();
        expect(uploaded.file).toMatch(/^vdbs\//);

        const listRes = await request.get(`/admin/tenants/${TENANT_ID}/vdb-files`);
        expect(listRes.ok()).toBeTruthy();
        const listJson = await listRes.json();
        const names = (listJson.files || []).map((f) => f.name);
        expect(names).toContain(uploaded.name);

        const worldsRes = await request.get(`/admin/tenants/${TENANT_ID}/worlds`);
        const worlds = await worldsRes.json();
        const worldId = worlds.school ? 'school' : Object.keys(worlds)[0];
        const vdbEntry = {
            id: `e2e-vdb-${Date.now()}`,
            file: uploaded.file,
            gridName: 'density',
            position: { x: 28, y: 26, z: 18 },
            rotation: { x: 0, y: 0, z: 0 },
            worldScale: 3.2,
            densityScale: 0.78,
            raySteps: 44,
            lightSteps: 5,
            extinction: 1.4,
            scattering: 0.85,
            ambient: 0.22,
            anisotropy: 0.55,
            tint: [0.93, 0.96, 1.0],
            sun: { yaw: 40, pitch: 58 },
        };
        const prevVdbs = Array.isArray(worlds[worldId]?.vdbs) ? worlds[worldId].vdbs : [];
        const patchRes = await request.post(`/admin/tenants/${TENANT_ID}/worlds/patch`, {
            headers: { 'Content-Type': 'application/json', ...headers },
            data: {
                worldId,
                patch: { vdbs: [...prevVdbs, vdbEntry] },
            },
        });
        expect(patchRes.ok(), await patchRes.text()).toBeTruthy();

        await page.goto(`/admin/tenant/${TENANT_ID}/world-edit`);
        await expect(page.locator('#canvas')).toBeVisible({ timeout: 120_000 });
        await page.waitForFunction(
            () => typeof globalThis.initVdbFilesPanel === 'function' || document.querySelector('#vdb-file-list'),
            undefined,
            { timeout: 120_000 },
        );
        await page.evaluate(() => {
            const btn = document.querySelector('.we-category-btn[data-we-category="vdb-volume"]');
            const pane = document.getElementById('we-cat-vdb-volume');
            btn?.classList.add('active');
            pane?.classList.add('active');
            btn?.click();
        });
        await expect(page.locator('#vdb-file-list .vdb-file-item').first()).toBeAttached({
            timeout: 60_000,
        });
        await page.screenshot({
            path: path.join(ARTIFACTS, 'vdb-admin-world-edit-library.png'),
            fullPage: true,
        });

        const staticRes = await request.get(`/${TENANT_ID}/${uploaded.file}`);
        expect(staticRes.ok()).toBeTruthy();

        const gamePage = await context.newPage();
        const user = `VdbAdminE2E-${Date.now()}`;
        await installTenantE2EHarness(gamePage);
        await setGuestUsername(gamePage, user);
        await gamePage.goto(`/${TENANT_ID}/?world=${worldId}`, { waitUntil: 'domcontentloaded' });
        await expectMetaverseReady(gamePage);
        await gamePage.waitForFunction(
            () => globalThis.__tenantVdbVolume?.meshCount >= 1 && globalThis.__tenantVdbVolume?.loading === false,
            undefined,
            { timeout: 180_000 },
        );

        const stats = await gamePage.evaluate(async (entryId) => {
            const mgr = globalThis.__tenantVdbVolumeManager;
            mgr?.frameVolumeForView?.(entryId, 'front');
            const app = mgr?.app;
            const renderer = app?.sceneManager?.getRenderer?.();
            for (let i = 0; i < 10; i++) {
                mgr?.applyCameraLock?.();
                await new Promise((r) => requestAnimationFrame(r));
                renderer?.render(app.sceneManager.getScene(), app.sceneManager.getCamera());
            }
            return mgr?.sampleCloudRegion?.(entryId);
        }, vdbEntry.id);

        expect(stats?.brightRatio ?? 0).toBeGreaterThan(0.15);
        await gamePage.screenshot({
            path: path.join(ARTIFACTS, 'vdb-admin-cloud-visible.png'),
            fullPage: false,
        });
        await gamePage.close();
    });
});