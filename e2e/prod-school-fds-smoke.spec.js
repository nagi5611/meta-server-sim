// e2e/prod-school-fds-smoke.spec.js — 本番 school ワールド FDS 煙・アニメ・煙判定
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
    enableDeveloperMode,
    installTenantE2EHarness,
} from './helpers/tenant-metaverse.mjs';
import {
    dismissBlockingModals,
    unlockGameplayPhysics,
} from './helpers/tenant-metaverse-agent.mjs';

const TENANT_ID = 'P-01';
const WORLD_ID = 'school';
const SMOKE_ID = 'fugaku-prod01-smoke';
// 配置原点モデル + manifest 上、終端フレームで高密度なワールド座標（オフラインサンプル検証済み）
const SMOKE_CENTER = { x: 27, y: 3.5, z: 10 };
const SMOKE_END_FRAME = 607;
const SHOT_DIR = path.join(process.cwd(), 'test-results', 'prod-school-fds-smoke');

function loadAdminPass() {
    const mcp = path.resolve(process.cwd(), '../metaverse-simple/mcp/metaverse-admin/.env.mcp');
    const env = fs.readFileSync(mcp, 'utf8');
    const b64 = env.match(/^META_ADMIN_PASSWORD_B64=(.*)$/m)?.[1]?.trim();
    if (!b64) throw new Error('.env.mcp missing');
    return Buffer.from(b64, 'base64').toString('utf8');
}

test.describe('prod school FDS smoke', () => {
    test.use({
        baseURL: process.env.PROD_SIM_URL || 'https://sim.mmh-virtual.jp',
        httpCredentials: { username: 'admin', password: loadAdminPass() },
    });

    test('smoke animation advances and inSmoke true at center', async ({ page }) => {
        test.setTimeout(600_000);
        fs.mkdirSync(SHOT_DIR, { recursive: true });

        await installTenantE2EHarness(page);
        await enableDeveloperMode(page);
        await page.goto(`/${TENANT_ID}/`);
        await expect
            .poll(
                async () => page.evaluate(() => document.documentElement.dataset.tenantMetaverseReady),
                { timeout: 300_000 },
            )
            .toBe('true');

        await dismissBlockingModals(page);
        await unlockGameplayPhysics(page);
        await waitForSocket(page);

        await page.evaluate(async (worldId) => {
            await window.__tenantE2E.switchToWorld(worldId);
        }, WORLD_ID);

        await expect
            .poll(
                async () =>
                    page.evaluate(() => {
                        const id = window.__tenantE2E?.getCurrentWorldId?.();
                        return id === 'school';
                    }),
                { timeout: 120_000 },
            )
            .toBe(true);

        await expect
            .poll(
                async () => page.evaluate(() => window.__tenantE2E?.fdsSmokeHasEntries?.()),
                { timeout: 300_000 },
            )
            .toBe(true);

        await page.screenshot({ path: path.join(SHOT_DIR, '01-world-loaded.png'), fullPage: false });

        await page.evaluate(
            async ({ smokeId }) => {
                const e2e = window.__tenantE2E;
                await e2e.startFdsSmokePlayback(smokeId, {
                    fromFrame: 0,
                    loop: true,
                    secondsPerFrame: 0.2,
                });
            },
            { smokeId: SMOKE_ID },
        );

        const frame0 = await page.evaluate((id) => window.__tenantE2E.getFdsSmokePlaybackFrame(id), SMOKE_ID);
        await page.waitForTimeout(3_000);
        const frame1 = await page.evaluate((id) => window.__tenantE2E.getFdsSmokePlaybackFrame(id), SMOKE_ID);
        await page.screenshot({ path: path.join(SHOT_DIR, '02-after-playback-start.png') });

        expect(frame1).not.toBeNull();
        expect(frame1).toBeGreaterThan(frame0 ?? 0);

        await page.evaluate(
            async ({ smokeId, frameIndex }) => {
                await window.__tenantE2E.seekFdsSmokeFrame(smokeId, frameIndex);
            },
            { smokeId: SMOKE_ID, frameIndex: SMOKE_END_FRAME },
        );

        await page.evaluate((pos) => {
            window.__tenantE2E.setLocalPosition(pos.x, pos.y, pos.z);
        }, SMOKE_CENTER);

        await page.waitForTimeout(2_000);
        await page.screenshot({ path: path.join(SHOT_DIR, '03-inside-smoke-position.png') });

        await expect
            .poll(
                async () => {
                    const probe = await page.evaluate(
                        (pos) => window.__tenantE2E.probeFdsSmokeAt(pos.x, pos.y + 2.3, pos.z),
                        SMOKE_CENTER,
                    );
                    return probe?.inSmoke === true && (probe?.normalized ?? 0) > 0;
                },
                { timeout: 60_000 },
            )
            .toBe(true);

        await expect
            .poll(
                async () => {
                    const sample = await page.evaluate(() => window.__tenantE2E.getFdsSmokeExposureSample());
                    return sample?.inSmoke === true && (sample?.normalized ?? 0) > 0;
                },
                { timeout: 60_000 },
            )
            .toBe(true);

        const hud = await page.locator('#fds-smoke-exposure-hud').textContent();
        expect(hud).toContain('煙内: はい');
    });
});

/**
 * @param {import('@playwright/test').Page} page
 */
async function waitForSocket(page) {
    await expect
        .poll(
            async () => page.evaluate(() => Boolean(window.__tenantE2E?.getSocket?.()?.connected)),
            { timeout: 120_000 },
        )
        .toBe(true);
}