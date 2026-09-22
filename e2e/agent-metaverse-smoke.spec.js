// e2e/agent-metaverse-smoke.spec.js — AI エージェント向けメタバース操作スモーク
import { test, expect } from '@playwright/test';
import {
    enterWorld,
    getSceneDebugInfo,
    pressGameplayKeys,
    waitForLocalMovement,
} from './helpers/tenant-metaverse-agent.mjs';

const SECURITY_CONSOLE_RE =
    /content security policy|violates the following Content Security Policy|Refused to (load|execute|connect|frame)|Mixed Content/i;

/**
 * CSP 等のセキュリティ関連コンソール行を収集
 * @param {import('@playwright/test').Page} page
 */
function attachSecurityConsoleWatch(page) {
    const lines = [];
    page.on('console', (msg) => {
        const line = `[${msg.type()}] ${msg.text()}`;
        if (SECURITY_CONSOLE_RE.test(line)) lines.push(line);
    });
    page.on('pageerror', (err) => {
        const line = `[pageerror] ${err}`;
        if (SECURITY_CONSOLE_RE.test(line)) lines.push(line);
    });
    return lines;
}

test.describe('agent metaverse smoke', () => {
    test('guest enters world, socket connects, W key moves avatar', async ({ page }) => {
        const securityConsole = attachSecurityConsoleWatch(page);
        const { username } = await enterWorld(page);
        expect(username.length).toBeGreaterThanOrEqual(2);

        /** @type {Awaited<ReturnType<typeof getSceneDebugInfo>> | undefined} */
        let before;
        await expect
            .poll(
                async () => {
                    const info = await getSceneDebugInfo(page);
                    if (
                        !info.harness ||
                        !info.ready ||
                        !info.socketConnected ||
                        info.physicsSuspended ||
                        !/^[1-9]/.test(info.playerCountText || '')
                    ) {
                        return false;
                    }
                    before = info;
                    return true;
                },
                { timeout: 45_000 },
            )
            .toBe(true);
        if (!before) {
            throw new Error('pre-move scene debug snapshot missing');
        }

        await pressGameplayKeys(page, ['KeyW'], { holdMs: 2000 });
        await waitForLocalMovement(page, 0.08, 25_000);

        const after = await getSceneDebugInfo(page);
        expect(after.position).not.toBeNull();
        const dx = after.position.x - before.position.x;
        const dz = after.position.z - before.position.z;
        expect(Math.hypot(dx, dz)).toBeGreaterThan(0.08);

        expect(
            securityConsole,
            `security console errors: ${securityConsole.join(' | ')}`,
        ).toEqual([]);
    });
});
