// e2e/prod-vc-duplex.spec.js — 本番: 2 クライアント音声・ビデオ VC 双方向（WebRTC シグナリング + consumer）
import { test, expect } from '@playwright/test';
import { enterWorld, dismissBlockingModals } from './helpers/tenant-metaverse-agent.mjs';

const TENANT_ID = process.env.E2E_TENANT_ID || 'P-01';

/**
 * @param {import('@playwright/test').Page} page
 */
async function joinVoiceAndUnmute(page) {
    await page.locator('#speaker-btn').click();
    await page.locator('#mic-btn').click();
}

/**
 * @param {import('@playwright/test').Page} page
 */
async function getVcDuplexState(page) {
    return page.evaluate(async () => {
        const vcm = window.__tenantE2E?.getVoiceChatManager?.();
        if (!vcm) return { error: 'no voice manager' };
        const waitMs = 45_000;
        const start = Date.now();
        while (Date.now() - start < waitMs) {
            const send = vcm.sendTransport?.connectionState;
            const recv = vcm.recvTransport?.connectionState;
            const producers = vcm.producers?.size ?? 0;
            const consumers = vcm.consumers?.size ?? 0;
            const joined = Boolean(vcm.isJoined);
            if (joined && producers > 0 && consumers > 0 && (send === 'connected' || !send) && (recv === 'connected' || !recv)) {
                return { joined, producers, consumers, send, recv };
            }
            await new Promise((r) => setTimeout(r, 500));
        }
        return {
            joined: Boolean(vcm.isJoined),
            producers: vcm.producers?.size ?? 0,
            consumers: vcm.consumers?.size ?? 0,
            send: vcm.sendTransport?.connectionState,
            recv: vcm.recvTransport?.connectionState,
            error: 'timeout',
        };
    });
}

test.describe('production VC duplex', () => {
    test('two clients audio VC: remote consumer appears', async ({ browser }) => {
        test.setTimeout(420_000);

        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        await enterWorld(pageA, { tenantId: TENANT_ID, username: `vc-a-${Date.now()}` });
        await enterWorld(pageB, { tenantId: TENANT_ID, username: `vc-b-${Date.now()}` });
        await dismissBlockingModals(pageA);
        await dismissBlockingModals(pageB);

        await joinVoiceAndUnmute(pageA);
        await joinVoiceAndUnmute(pageB);

        const stateA = await getVcDuplexState(pageA);
        const stateB = await getVcDuplexState(pageB);

        expect(stateA.error, JSON.stringify(stateA)).toBeFalsy();
        expect(stateB.error, JSON.stringify(stateB)).toBeFalsy();
        expect(stateA.consumers, `A consumers: ${JSON.stringify(stateA)}`).toBeGreaterThan(0);
        expect(stateB.consumers, `B consumers: ${JSON.stringify(stateB)}`).toBeGreaterThan(0);

        await ctxA.close();
        await ctxB.close();
    });

    test('two clients video VC: remote video producer visible', async ({ browser }) => {
        test.setTimeout(420_000);

        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        await installTenantE2EHarness(pageA);
        await installTenantE2EHarness(pageB);
        await setGuestUsername(pageA, `vv-a-${Date.now()}`);
        await setGuestUsername(pageB, `vv-b-${Date.now()}`);

        await pageA.goto(`/${TENANT_ID}/`);
        await pageB.goto(`/${TENANT_ID}/`);
        await expectMetaverseReady(pageA);
        await expectMetaverseReady(pageB);

        await pageA.locator('#video-btn').click();
        await pageB.locator('#video-btn').click();
        await expect(pageA.locator('#video-modal')).toHaveClass(/visible/, { timeout: 30_000 });
        await expect(pageB.locator('#video-modal')).toHaveClass(/visible/, { timeout: 30_000 });

        const videoOn = page.locator('#video-modal [data-action="enable-video"], #video-enable-btn, #video-modal .video-enable');
        if (await videoOn.first().isVisible({ timeout: 5_000 }).catch(() => false)) {
            await videoOn.first().click();
            await videoOn.first().click();
        }

        const stateB = await pageB.evaluate(async () => {
            const vcm = window.__tenantE2E?.getVideoChatManager?.();
            const waitMs = 60_000;
            const start = Date.now();
            while (Date.now() - start < waitMs) {
                const consumers = vcm?.consumers?.size ?? 0;
                const videoConsumers = vcm?.videoConsumers?.size ?? consumers;
                if (consumers > 0 || videoConsumers > 0) {
                    return { consumers, videoConsumers, joined: vcm?.isJoined };
                }
                await new Promise((r) => setTimeout(r, 500));
            }
            return { consumers: 0, joined: vcm?.isJoined, error: 'timeout' };
        });

        expect(stateB.error, JSON.stringify(stateB)).toBeFalsy();
        expect(stateB.consumers + (stateB.videoConsumers || 0)).toBeGreaterThan(0);

        await ctxA.close();
        await ctxB.close();
    });
});
