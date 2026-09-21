// e2e/agent-metaverse-smoke.spec.js — AI エージェント向けメタバース操作スモーク
import { test, expect } from '@playwright/test';
import {
    enterWorld,
    getSceneDebugInfo,
    pressGameplayKeys,
    waitForLocalMovement,
    waitForSocketConnected,
} from './helpers/tenant-metaverse-agent.mjs';

test.describe('agent metaverse smoke', () => {
    test('guest enters world, socket connects, W key moves avatar', async ({ page }) => {
        const { username } = await enterWorld(page);
        expect(username.length).toBeGreaterThanOrEqual(2);

        await waitForSocketConnected(page);
        const before = await getSceneDebugInfo(page);

        expect(before.harness, '__tenantE2E harness').toBe(true);
        expect(before.ready, 'metaverse ready flag').toBe(true);
        expect(before.socketConnected, 'socket connected').toBe(true);
        expect(before.physicsSuspended, 'physics after unlock').toBe(false);
        expect(before.playerCountText).toMatch(/^[1-9]/);

        await pressGameplayKeys(page, ['KeyW'], { holdMs: 2000 });
        await waitForLocalMovement(page, 0.08, 25_000);

        const after = await getSceneDebugInfo(page);
        expect(after.position).not.toBeNull();
        const dx = after.position.x - before.position.x;
        const dz = after.position.z - before.position.z;
        expect(Math.hypot(dx, dz)).toBeGreaterThan(0.08);
    });
});
