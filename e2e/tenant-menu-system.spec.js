// e2e/tenant-menu-system.spec.js — テナントメインメニュー全機能 E2E
import { test, expect } from '@playwright/test';
import {
    TENANT_ID,
    HAS_GEMINI,
    expectMetaverseReady,
    fetchAdminMetaverseToken,
    gotoTenantMetaverse,
    installTenantE2EHarness,
    setAdminToken,
    setGuestUsername,
} from './helpers/tenant-metaverse.mjs';

const MENU_BUTTON_IDS = [
    'mic-btn',
    'speaker-btn',
    'captions-btn',
    'stamp-btn',
    'video-btn',
    'help-btn',
    'restart-world-btn',
    'settings-btn',
    'logout-btn',
];

test.describe('tenant menu — UI (Phase 0–1)', () => {
    test('menu bar shows all standard buttons', async ({ page }) => {
        await gotoTenantMetaverse(page);
        for (const id of MENU_BUTTON_IDS) {
            await expect(page.locator(`#${id}`)).toBeVisible();
        }
        await expect(page.locator('#chat-container')).toBeVisible();
        await expect(page.locator('#emoji-menu')).toBeAttached();
    });

    test('settings modal opens and language can be changed', async ({ page }) => {
        await gotoTenantMetaverse(page);
        await page.locator('#settings-btn').click();
        await expect(page.locator('#settings-modal.visible')).toBeVisible();

        const language = page.locator('#language');
        await expect(language).toBeVisible();
        await language.selectOption('en');
        await expect(language).toHaveValue('en');

        await page.locator('#settings-close-btn').click();
        await expect(page.locator('#settings-modal.visible')).toHaveCount(0);
    });

    test('help modal opens and closes', async ({ page }) => {
        await gotoTenantMetaverse(page);
        await page.locator('#help-btn').click();
        await expect(page.locator('#help-modal')).toHaveClass(/visible/);
        await page.locator('#help-close-btn').click();
        await expect(page.locator('#help-modal.visible')).toHaveCount(0);
    });

    test('restart modal opens and can be cancelled', async ({ page }) => {
        await gotoTenantMetaverse(page);
        await page.locator('#restart-world-btn').click();
        await expect(page.locator('#restart-modal')).toHaveClass(/visible/);
        await page.locator('#restart-modal-cancel-btn').click();
        await expect(page.locator('#restart-modal.visible')).toHaveCount(0);
    });

    test('logout modal opens without navigating away', async ({ page }) => {
        await gotoTenantMetaverse(page);
        const urlBefore = page.url();
        await page.locator('#logout-btn').click();
        await expect(page.locator('#logout-modal')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page).toHaveURL(urlBefore);
    });
});

test.describe('tenant menu — chat & stamp (Phase 2)', () => {
    test('emoji stamp syncs between two clients', async ({ browser }) => {
        const suffix = Date.now();
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        await setGuestUsername(pageA, `StampA-${suffix}`);
        await setGuestUsername(pageB, `StampB-${suffix}`);

        await gotoTenantMetaverse(pageA);
        await gotoTenantMetaverse(pageB);

        const emojiReceived = pageB.waitForFunction(
            () => document.querySelectorAll('.player-emoji').length > 0,
            null,
            { timeout: 30_000 },
        );

        await pageA.locator('#stamp-btn').click();
        await expect(pageA.locator('#emoji-menu.show')).toBeVisible();
        await pageA.locator('#emoji-menu .emoji-btn').first().click();

        await emojiReceived;
        await expect(pageB.locator('.player-emoji')).toHaveCount(1, { timeout: 5000 });

        await ctxA.close();
        await ctxB.close();
    });

    test('chat send is rejected when GEMINI_API_KEY is unset', async ({ page }) => {
        test.skip(HAS_GEMINI, 'GEMINI_API_KEY is set — use gemini chat test instead');

        await gotoTenantMetaverse(page);
        const input = page.locator('#chat-input');
        await input.fill('E2E smoke message');
        await page.locator('#chat-send-btn').click();

        await expect
            .poll(async () => page.locator('#chat-messages .chat-message').count(), { timeout: 10_000 })
            .toBe(0);
    });

    test('chat message delivers when GEMINI_API_KEY is set', async ({ browser }) => {
        test.skip(!HAS_GEMINI, 'GEMINI_API_KEY not configured');

        const suffix = Date.now();
        const ctxA = await browser.newContext();
        const ctxB = await browser.newContext();
        const pageA = await ctxA.newPage();
        const pageB = await ctxB.newPage();

        await setGuestUsername(pageA, `ChatA-${suffix}`);
        await setGuestUsername(pageB, `ChatB-${suffix}`);

        await gotoTenantMetaverse(pageA);
        await gotoTenantMetaverse(pageB);

        const uniqueMsg = `E2E chat ${suffix}`;
        await pageA.locator('#chat-input').fill(uniqueMsg);
        await pageA.locator('#chat-send-btn').click();

        await expect(pageB.locator('#chat-messages')).toContainText(uniqueMsg, { timeout: 60_000 });

        await ctxA.close();
        await ctxB.close();
    });
});

test.describe('tenant menu — voice & video VC (Phase 3–4)', () => {
    test('vc-join returns rtpCapabilities (server socket)', async () => {
        const { connectTenantSocket, emitAck, disconnectSocket } = await import(
            './helpers/tenant-socket.mjs'
        );
        const socket = await connectTenantSocket();
        try {
            const res = await emitAck(socket, 'vc-join', { roomId: 'lobby' });
            expect(res?.error).toBeFalsy();
            expect(res?.rtpCapabilities).toBeTruthy();
            expect(Array.isArray(res?.iceServers)).toBe(true);
        } finally {
            disconnectSocket(socket);
        }
    });

    test('video-vc-join returns rtpCapabilities (server socket)', async () => {
        const { connectTenantSocket, emitAck, disconnectSocket } = await import(
            './helpers/tenant-socket.mjs'
        );
        const socket = await connectTenantSocket();
        try {
            const res = await emitAck(socket, 'video-vc-join', { roomId: 'lobby' });
            expect(res?.error).toBeFalsy();
            expect(res?.rtpCapabilities).toBeTruthy();
        } finally {
            disconnectSocket(socket);
        }
    });

    test('video modal opens from menu button', async ({ page }) => {
        await gotoTenantMetaverse(page);
        await page.locator('#video-btn').click();
        await expect(page.locator('#video-modal')).toHaveClass(/visible/);
    });
});

test.describe('tenant menu — captions (Phase 5)', () => {
    test('captions button is present in menu bar', async ({ page }) => {
        await gotoTenantMetaverse(page);
        await expect(page.locator('#captions-btn')).toBeVisible();
    });
});

test.describe('tenant menu — admin (Phase 6)', () => {
    test('admin enter-metaverse API issues token', async ({ request }) => {
        const token = await fetchAdminMetaverseToken(request);
        expect(token.length).toBeGreaterThan(20);
    });

    test('admin menu button visible with valid token', async ({ page, request }) => {
        const token = await fetchAdminMetaverseToken(request);
        await installTenantE2EHarness(page);
        await setAdminToken(page, token);
        await page.goto(`/${TENANT_ID}/`);
        await expectMetaverseReady(page);

        await expect(page.locator('#admin-menu-btn')).toBeVisible();
        await page.locator('#admin-menu-btn').click();
        await expect(page.locator('#admin-menu')).toBeVisible();
        await expect(page.locator('#admin-invisible-toggle')).toBeVisible();
    });

    test('admin invisible hides admin from other player list', async ({ browser, request }) => {
        const suffix = Date.now();
        const adminToken = await fetchAdminMetaverseToken(request);

        const guestCtx = await browser.newContext();
        const adminCtx = await browser.newContext();
        const guestPage = await guestCtx.newPage();
        const adminPage = await adminCtx.newPage();

        await setGuestUsername(guestPage, `Guest-${suffix}`);
        await installTenantE2EHarness(guestPage);
        await gotoTenantMetaverse(guestPage);

        await installTenantE2EHarness(adminPage);
        await setAdminToken(adminPage, adminToken);
        await setGuestUsername(adminPage, `Admin-${suffix}`);
        await adminPage.goto(`/${TENANT_ID}/`);
        await expectMetaverseReady(adminPage);

        const adminDisplayName = `Admin-${suffix}`;
        await expect
            .poll(async () => guestPage.locator('#player-list').textContent(), { timeout: 30_000 })
            .toContain(adminDisplayName);

        await adminPage.locator('#admin-menu-btn').click();
        await adminPage.locator('#admin-invisible-toggle').check();

        await expect
            .poll(async () => guestPage.locator('#player-list').textContent(), { timeout: 30_000 })
            .not.toContain(adminDisplayName);

        await guestCtx.close();
        await adminCtx.close();
    });
});

test.describe('tenant menu — server health', () => {
    test('tenant socket connects and player count updates', async ({ page }) => {
        await gotoTenantMetaverse(page);
        await expect
            .poll(async () => page.locator('#player-count').textContent(), { timeout: 15_000 })
            .toMatch(/^[1-9]/);
    });
});
