// e2e/tenant-fugaku-prod01-smoke.spec.js — Fugaku prod01 煙をロビーに配置しメタバースで表示
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import {
    exerciseSettingsModalSmoke,
    expectMetaverseReady,
    installTenantE2EHarness,
    openStampMenu,
} from './helpers/tenant-metaverse.mjs';

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'dev-admin-password-16';
const TENANT_ID = 'P-01';
const WORLD_ID = 'lobby';
const SIM_ID = 'fugaku-prod01';
const MANIFEST_PATH = `simulations/${SIM_ID}/manifest.json`;
const SMOKE_POS = { x: 40, y: 20, z: 15 };

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
 * シミュレーションが未登録なら ZIP を API でアップロードする（既存フォルダはスキップ）
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

test.describe('fugaku-prod01 FDS smoke in lobby', () => {
    test.describe.configure({ mode: 'serial' });

    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('world-edit UI assigns fugaku-prod01 to lobby', async ({ page, request }) => {
        test.setTimeout(600_000);

        const zipPath = process.env.FUGAKU_SMOKE_ZIP || DEFAULT_ZIP;
        await ensureSimulationUploaded(request, zipPath);

        await page.goto(`/admin/tenant/${TENANT_ID}/world-edit`);
        await expect(page.locator('#canvas')).toBeVisible({ timeout: 120_000 });
        await expect(page.locator('#world-list .item').first()).toBeVisible({ timeout: 120_000 });

        const lobbyItem = page.locator('#world-list .item').filter({ hasText: 'Lobby' });
        await expect(lobbyItem).toBeVisible();
        await lobbyItem.click();
        await expect(lobbyItem).toHaveClass(/selected/);

        await page.locator('.we-category-btn[data-we-category="fds-smoke"]').click();
        await expect(page.locator('#we-cat-fds-smoke')).toBeVisible();

        const simItem = page.locator('.fds-smoke-sim-item').filter({ hasText: SIM_ID });
        await expect(simItem).toBeVisible({ timeout: 60_000 });

        const addToWorldBtn = simItem.locator('.fds-smoke-add-to-world-btn');
        await expect(addToWorldBtn).toBeEnabled();
        await addToWorldBtn.click();

        await expect(page.locator('#fds-smoke-add-status')).toContainText(/ワールドに追加|既にワールドに追加済み/, {
            timeout: 30_000,
        });

        const fdsItem = page.locator('#world-object-list .object-list-item', { hasText: 'fugaku-prod01-smoke' });
        await expect(fdsItem).toBeVisible({ timeout: 30_000 });
        await fdsItem.click();
        await expect(page.locator('#object-props')).toBeVisible();
        await expect(page.locator('#obj-path')).toHaveValue(/fugaku-prod01/);

        await page.locator('#obj-pos-x').fill(String(SMOKE_POS.x));
        await page.locator('#obj-pos-y').fill(String(SMOKE_POS.y));
        await page.locator('#obj-pos-z').fill(String(SMOKE_POS.z));
        await page.locator('#obj-scale-x').fill('1');
        await page.locator('#obj-pos-x').dispatchEvent('change');

        await page.locator('.we-category-btn[data-we-category="file"]').click();
        await expect(page.locator('#we-cat-file')).toBeVisible();
        await page.locator('#btn-save').click();
        await expect(page.locator('#save-status')).toContainText('保存しました', { timeout: 30_000 });

        const worldsRes = await request.get(`/admin/tenants/${TENANT_ID}/worlds`);
        expect(worldsRes.ok()).toBeTruthy();
        const worlds = await worldsRes.json();
        expect(worlds[WORLD_ID]?.fdsSmokes).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    id: `${SIM_ID}-smoke`,
                    manifest: MANIFEST_PATH,
                    position: SMOKE_POS,
                    scale: 1,
                }),
            ]),
        );

        await expect(page.locator('#obj-pos-x')).toHaveValue(String(SMOKE_POS.x));

        await expect
            .poll(
                async () => {
                    const res = await request.get(`/admin/tenants/${TENANT_ID}/worlds`);
                    if (!res.ok()) return false;
                    const latest = await res.json();
                    const entry = latest[WORLD_ID]?.fdsSmokes?.find(
                        (e) => e.manifest === MANIFEST_PATH || e.id === `${SIM_ID}-smoke`,
                    );
                    return (
                        entry &&
                        entry.position?.x === SMOKE_POS.x &&
                        entry.position?.y === SMOKE_POS.y &&
                        entry.position?.z === SMOKE_POS.z
                    );
                },
                { timeout: 30_000 },
            )
            .toBe(true);
    });

    test('P-01 lobby loads fugaku-prod01 smoke volume', async ({ page, request }) => {
        test.setTimeout(600_000);

        let lobbySmoke;
        await expect
            .poll(
                async () => {
                    const worldsRes = await request.get(`/admin/tenants/${TENANT_ID}/worlds`);
                    if (!worldsRes.ok()) return false;
                    const worlds = await worldsRes.json();
                    lobbySmoke = worlds[WORLD_ID]?.fdsSmokes?.find(
                        (e) => e.manifest === MANIFEST_PATH || e.id === `${SIM_ID}-smoke`,
                    );
                    return Boolean(lobbySmoke);
                },
                { timeout: 60_000 },
            )
            .toBe(true);
        expect(
            lobbySmoke,
            'lobby.fdsSmokes must include fugaku-prod01 — run assign test first or assign via world-edit UI',
        ).toBeTruthy();

        const consoleLines = [];
        page.on('console', (msg) => {
            consoleLines.push(`[${msg.type()}] ${msg.text()}`);
        });
        page.on('pageerror', (err) => {
            consoleLines.push(`[pageerror] ${err}`);
        });

        await installTenantE2EHarness(page);
        const manifestPromise = page.waitForResponse(
            (res) => res.url().includes(MANIFEST_PATH) && res.ok(),
            { timeout: 120_000 },
        );
        const partPromise = page.waitForResponse(
            (res) =>
                res.url().includes(SIM_ID) &&
                res.url().includes('.uint8.bin') &&
                res.ok(),
            { timeout: 300_000 },
        );

        await page.goto(`/${TENANT_ID}/`);

        const [, manifestRes] = await Promise.all([
            (async () => {
                await expectMetaverseReady(page);
                await exerciseSettingsModalSmoke(page);
                await openStampMenu(page);
            })(),
            manifestPromise,
        ]);
        const manifest = await manifestRes.json();
        expect(manifest.frameCount).toBeGreaterThan(100);
        expect(manifest.multipart).toBe(true);

        const partRes = await partPromise;
        expect(partRes.status()).toBe(200);
        const contentLength = Number(partRes.headers()['content-length'] ?? 0);
        expect(contentLength).toBeGreaterThan(1_000_000);

        const fdsFailures = consoleLines.filter(
            (t) =>
                t.includes('TenantFdsSmokeManager') &&
                (t.includes('failed') || t.includes('Failed to load manifest')),
        );
        expect(fdsFailures, fdsFailures.join(' | ')).toEqual([]);
    });
});
