// e2e/tenant-fds-smoke-control-panel.spec.js — school の in-world 煙再生パネル
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import {
    TENANT_ID,
    ADMIN_USER,
    ADMIN_PASS,
    installTenantE2EHarness,
    setGuestUsername,
    expectMetaverseReady,
    waitForSocketConnected,
    getFdsSmokeControlPanelCounts,
    FDS_SMOKE_CONTROL_PANEL_MESH_NAME,
} from './helpers/tenant-metaverse.mjs';
import {
    dismissBlockingModals,
    unlockGameplayPhysics,
} from './helpers/tenant-metaverse-agent.mjs';

const WORLD_ID = 'school';
const SIM_ID = 'fugaku-prod01';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_ZIP = path.join(
    PROJECT_ROOT,
    'tenants',
    TENANT_ID,
    'data',
    'simulations',
    `${SIM_ID}.zip`,
);

/**
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} zipPath
 */
async function ensureSimulationUploaded(request, zipPath) {
    const listRes = await request.get(`/admin/tenants/${TENANT_ID}/simulations`);
    expect(listRes.ok()).toBeTruthy();
    const listJson = await listRes.json();
    if (listJson.simulations?.some((s) => s.id === SIM_ID)) {
        return;
    }
    if (!fs.existsSync(zipPath)) {
        throw new Error(
            `Simulation "${SIM_ID}" not found and ZIP missing at ${zipPath}. Run npm run export:fugaku-prod01-smoke first.`,
        );
    }
    const csrfRes = await request.get('/admin/csrf-token');
    expect(csrfRes.ok()).toBeTruthy();
    const { token } = await csrfRes.json();
    const uploadRes = await request.post(
        `/admin/tenants/${TENANT_ID}/upload-fds-smoke-zip?confirm=1`,
        {
            headers: { 'X-Admin-CSRF': token },
            multipart: {
                zip: {
                    name: `${SIM_ID}.zip`,
                    mimeType: 'application/zip',
                    buffer: fs.readFileSync(zipPath),
                },
                simId: SIM_ID,
            },
            timeout: 600_000,
        },
    );
    expect(
        uploadRes.ok(),
        `upload-fds-smoke-zip ${uploadRes.status()} ${await uploadRes.text()}`,
    ).toBeTruthy();
}

/**
 * school に panel 付き fdsSmokeButtons が定義されていること
 * @param {Record<string, object>} worlds
 */
function expectSchoolHasSmokeButton(worlds) {
    const buttons = worlds[WORLD_ID]?.fdsSmokeButtons;
    expect(Array.isArray(buttons)).toBeTruthy();
    expect(buttons.length, 'school.fdsSmokeButtons must have at least one button').toBeGreaterThan(0);
}

test.describe('FDS smoke control panel (in-world)', () => {
    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('school world: fds-smoke-control-panel mesh is created after world switch', async ({
        page,
        request,
    }) => {
        test.setTimeout(600_000);

        const zipPath = process.env.FUGAKU_SMOKE_ZIP || DEFAULT_ZIP;
        await ensureSimulationUploaded(request, zipPath);

        const worldsRes = await request.get(`/admin/tenants/${TENANT_ID}/worlds`);
        expect(worldsRes.ok()).toBeTruthy();
        const worlds = await worldsRes.json();
        expect(worlds[WORLD_ID]?.fdsSmokes?.length).toBeGreaterThan(0);
        expectSchoolHasSmokeButton(worlds);

        await installTenantE2EHarness(page);
        await setGuestUsername(page, `E2E-SmokePanel-${Date.now()}`);

        await page.goto(`/${TENANT_ID}/`);
        await expectMetaverseReady(page);
        await dismissBlockingModals(page);
        await waitForSocketConnected(page);
        await unlockGameplayPhysics(page);

        await page.evaluate(async (worldId) => {
            const e2e = window.__tenantE2E;
            if (!e2e?.switchToWorld) {
                throw new Error('__tenantE2E.switchToWorld missing');
            }
            await e2e.switchToWorld(worldId);
        }, WORLD_ID);

        await expect
            .poll(async () => page.evaluate(() => window.__tenantE2E?.getCurrentWorldId?.()), {
                timeout: 120_000,
            })
            .toBe(WORLD_ID);

        await expect
            .poll(
                async () => {
                    try {
                        return await getFdsSmokeControlPanelCounts(page);
                    } catch (err) {
                        const msg = err instanceof Error ? err.message : String(err);
                        if (msg.includes('Execution context was destroyed')) {
                            return { total: 0, visible: 0 };
                        }
                        throw err;
                    }
                },
                { timeout: 60_000 },
            )
            .toEqual({ total: 1, visible: 1 });

        expect(FDS_SMOKE_CONTROL_PANEL_MESH_NAME).toBe('fds-smoke-control-panel');
    });
});
