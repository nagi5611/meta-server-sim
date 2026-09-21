// e2e/tenant-fds-smoke-head-debug-ball.spec.js — 開発者モードの FDS 煙ヘッドデバッグ球が1台だけ
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import {
    TENANT_ID,
    ADMIN_USER,
    ADMIN_PASS,
    installTenantE2EHarness,
    enableDeveloperMode,
    expectMetaverseReady,
    getHeadDebugBallCounts,
    setGuestUsername,
    waitForSocketConnected,
    FDS_SMOKE_HEAD_DEBUG_MESH_NAME,
} from './helpers/tenant-metaverse.mjs';
import {
    dismissBlockingModals,
    unlockGameplayPhysics,
} from './helpers/tenant-metaverse-agent.mjs';

const WORLD_ID = 'school';
const SIM_ID = 'fugaku-prod01';
const MANIFEST_PATH = `simulations/${SIM_ID}/manifest.json`;

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
 * シミュレーションが未登録なら ZIP を API でアップロードする
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} zipPath
 */
async function ensureSimulationUploaded(request, zipPath) {
    const listRes = await request.get(`/admin/tenants/${TENANT_ID}/simulations`);
    expect(listRes.ok()).toBeTruthy();
    const listJson = await listRes.json();
    const exists = listJson.simulations?.some((s) => s.id === SIM_ID);
    if (exists) {
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
 * メタバース初期化・ワールド表示・harness API が揃うまで待つ
 * @param {import('@playwright/test').Page} page
 */
async function expectMetaverseStableForFds(page) {
    await expect
        .poll(
            async () => {
                try {
                    return await page.evaluate(() => {
                        if (document.documentElement.dataset.tenantMetaverseReady !== 'true') {
                            return false;
                        }
                        const worldName = document.querySelector('#world-name')?.textContent?.trim();
                        if (!worldName || worldName === '-') {
                            return false;
                        }
                        return Boolean(window.__tenantE2E?.loadFdsSmokeFromWorld);
                    });
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.includes('Execution context was destroyed')) {
                        return false;
                    }
                    throw err;
                }
            },
            { timeout: 300_000 },
        )
        .toBe(true);
}

/**
 * school 定義から FDS smoke を読み込み、エントリが揃うまで待つ（ロビー自動読込も許容）
 * @param {import('@playwright/test').Page} page
 * @param {string} worldId
 */
async function loadSchoolFdsSmokeWhenStable(page, worldId) {
    let schoolLoadTriggered = false;
    let pollCount = 0;
    const lobbyAutoloadPolls = 40;

    await expect
        .poll(
            async () => {
                pollCount += 1;
                try {
                    const status = await page.evaluate(
                        async ({ id, runSchoolLoad }) => {
                            const e2e = window.__tenantE2E;
                            if (!e2e?.loadFdsSmokeFromWorld) {
                                return 'wait-harness';
                            }
                            if (e2e.fdsSmokeHasEntries()) {
                                return 'ready';
                            }
                            if (!runSchoolLoad) {
                                return 'wait-load';
                            }
                            await e2e.loadFdsSmokeFromWorld(id);
                            return e2e.fdsSmokeHasEntries() ? 'ready' : 'wait-load';
                        },
                        {
                            id: worldId,
                            runSchoolLoad:
                                schoolLoadTriggered ||
                                pollCount > lobbyAutoloadPolls,
                        },
                    );

                    if (status === 'wait-harness' || status === 'wait-load') {
                        if (
                            status === 'wait-load' &&
                            !schoolLoadTriggered &&
                            pollCount > lobbyAutoloadPolls
                        ) {
                            schoolLoadTriggered = true;
                        }
                        return false;
                    }
                    return status === 'ready';
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.includes('Execution context was destroyed')) {
                        schoolLoadTriggered = false;
                        pollCount = 0;
                        return false;
                    }
                    throw err;
                }
            },
            { timeout: 600_000 },
        )
        .toBe(true);
}

test.describe('FDS smoke head debug ball (ボール1台)', () => {
    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('school world: exactly one fds-smoke-head-debug mesh visible in developer mode', async ({
        page,
        request,
    }) => {
        test.setTimeout(900_000);

        const zipPath = process.env.FUGAKU_SMOKE_ZIP || DEFAULT_ZIP;
        await ensureSimulationUploaded(request, zipPath);

        const worldsRes = await request.get(`/admin/tenants/${TENANT_ID}/worlds`);
        expect(worldsRes.ok()).toBeTruthy();
        const worlds = await worldsRes.json();
        expect(worlds[WORLD_ID]?.fdsSmokes?.length).toBeGreaterThan(0);

        await installTenantE2EHarness(page);
        await enableDeveloperMode(page);
        await setGuestUsername(page, `E2E-HeadDebug-${Date.now()}`);

        await page.goto(`/${TENANT_ID}/`);
        await expectMetaverseReady(page);
        await dismissBlockingModals(page);
        await waitForSocketConnected(page);
        await expectMetaverseStableForFds(page);
        await unlockGameplayPhysics(page);

        const manifestPromise = page
            .waitForResponse(
                (res) => res.url().includes(MANIFEST_PATH) && res.ok(),
                { timeout: 600_000 },
            )
            .catch(() => null);

        await loadSchoolFdsSmokeWhenStable(page, WORLD_ID);
        await manifestPromise;

        await expect
            .poll(
                async () => {
                    try {
                        return await getHeadDebugBallCounts(page);
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

        const hudHidden = await page.locator('#fds-smoke-exposure-hud').getAttribute('hidden');
        expect(hudHidden).toBeNull();

        await expect
            .poll(
                async () =>
                    page.evaluate(() => {
                        const text = document.getElementById('fds-smoke-exposure-hud')?.textContent ?? '';
                        return text.includes('FDS') || text.includes('正規化');
                    }),
                { timeout: 30_000 },
            )
            .toBe(true);

        expect(FDS_SMOKE_HEAD_DEBUG_MESH_NAME).toBe('fds-smoke-head-debug');
    });
});
