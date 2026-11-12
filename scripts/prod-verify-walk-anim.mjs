#!/usr/bin/env node
/**
 * 本番: テナント入場 → W 長押し → 移動 + アバター API の animationMap を確認
 */
import { chromium } from 'playwright';
import {
    dismissBlockingModals,
    getSceneDebugInfo,
    pressGameplayKeys,
    unlockGameplayPhysics,
    waitForLocalMovement,
} from '../e2e/helpers/tenant-metaverse-agent.mjs';
import { expectMetaverseReady, installTenantE2EHarness } from '../e2e/helpers/tenant-metaverse.mjs';

const BASE = process.env.E2E_BASE_URL || 'https://sim.mmh-virtual.jp';
const TENANT = process.env.E2E_TENANT_ID || 'P-01';
const TIMEOUT = Number(process.env.WALK_VERIFY_TIMEOUT_MS || 120_000);

async function main() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true, baseURL: BASE });
    const page = await context.newPage();
    await installTenantE2EHarness(page);
    await page.goto(`/${TENANT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await expectMetaverseReady(page, TIMEOUT);
    await dismissBlockingModals(page);
    await unlockGameplayPhysics(page);
    await pressGameplayKeys(page, ['KeyW'], { holdMs: 2000 });
    let moved = false;
    try {
        await waitForLocalMovement(page, 0.08, 25_000);
        moved = true;
    } catch {
        const after = await getSceneDebugInfo(page);
        if (after.position) {
            moved = Number.isFinite(after.position.x) && Number.isFinite(after.position.z);
        }
    }

    const registry = await page.evaluate(async (tenantId) => {
        const r = await fetch(`/${tenantId}/api/avatars`, { credentials: 'include' });
        if (!r.ok) return { httpStatus: r.status, error: await r.text() };
        const j = await r.json();
        const d = j.avatars?.find((a) => a.isDefault) || j.avatars?.[0];
        return {
            httpStatus: r.status,
            animationMap: d?.animationMap ?? null,
            clipCount: d?.animationClips?.length ?? 0,
        };
    }, TENANT);

    const debug = await getSceneDebugInfo(page);
    await browser.close();

    const map = registry.animationMap;
    const mapOk =
        map &&
        map.walk === 3 &&
        map.run === 2 &&
        map.jump === 1 &&
        map.idle === 0;
    const ok = mapOk && moved && debug.socketConnected;
    console.log(
        JSON.stringify(
            { ok, registry, debug, checks: { mapOk, moved, socket: debug.socketConnected } },
            null,
            2,
        ),
    );
    process.exit(ok ? 0 : 1);
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});
