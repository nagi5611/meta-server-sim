// e2e/helpers/tenant-metaverse.mjs — テナントメタバース E2E 共通ヘルパー
import { expect } from '@playwright/test';

export const TENANT_ID = process.env.E2E_TENANT_ID || 'P-01';
export const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
export const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'dev-admin-password-16';
export const HAS_GEMINI = Boolean(String(process.env.GEMINI_API_KEY || '').trim());

/**
 * E2E 用 harness フラグと操作方式を事前設定
 * @param {import('@playwright/test').Page} page
 */
export async function installTenantE2EHarness(page) {
    await page.addInitScript(() => {
        window.__TENANT_E2E_HARNESS__ = '1';
        document.documentElement.dataset.e2eHarness = '1';
        try {
            localStorage.setItem('metaverse-control-scheme', 'keyboard');
        } catch {
            /* ignore */
        }
    });
}

/**
 * 開発者モードを localStorage で有効化（ページ読み込み前に呼ぶ）
 * @param {import('@playwright/test').Page} page
 */
export async function enableDeveloperMode(page) {
    await page.addInitScript(() => {
        try {
            const raw = localStorage.getItem('metaverse-settings');
            let settings = {};
            if (raw) {
                const parsed = JSON.parse(raw);
                if (parsed && typeof parsed === 'object') {
                    settings = parsed;
                }
            }
            settings.developerMode = true;
            localStorage.setItem('metaverse-settings', JSON.stringify(settings));
        } catch {
            try {
                localStorage.setItem(
                    'metaverse-settings',
                    JSON.stringify({ developerMode: true }),
                );
            } catch {
                /* ignore */
            }
        }
    });
}

/** FDS 煙ヘッドデバッグ球の mesh 名 */
export const FDS_SMOKE_HEAD_DEBUG_MESH_NAME = 'fds-smoke-head-debug';

/**
 * シーン内のヘッドデバッグ球数（__tenantE2E 必須）
 * @param {import('@playwright/test').Page} page
 */
export async function getHeadDebugBallCounts(page) {
    return page.evaluate((meshName) => {
        const e2e = window.__tenantE2E;
        if (!e2e?.countMeshesNamed) {
            throw new Error('__tenantE2E.countMeshesNamed missing — use installTenantE2EHarness');
        }
        return e2e.countMeshesNamed(meshName);
    }, FDS_SMOKE_HEAD_DEBUG_MESH_NAME);
}

/**
 * 一意のゲスト名を localStorage に設定
 * @param {import('@playwright/test').Page} page
 * @param {string} username
 */
export async function setGuestUsername(page, username) {
    await page.addInitScript((name) => {
        try {
            localStorage.setItem('username', name);
        } catch {
            /* ignore */
        }
    }, username);
}

/**
 * 管理画面ワンタイム token を sessionStorage に設定
 * @param {import('@playwright/test').Page} page
 * @param {string} token
 */
export async function setAdminToken(page, token) {
    await page.addInitScript((t) => {
        try {
            sessionStorage.setItem('metaverseAdminToken', t);
        } catch {
            /* ignore */
        }
    }, token);
}

/**
 * メタバース初期化完了まで待つ
 * @param {import('@playwright/test').Page} page
 */
export async function expectMetaverseReady(page) {
    const consoleLines = [];
    page.on('console', (msg) => {
        consoleLines.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
        consoleLines.push(`[pageerror] ${err}`);
    });

    const controlOverlay = page.locator('#control-scheme-keyboard-btn');
    if (await controlOverlay.isVisible({ timeout: 3000 }).catch(() => false)) {
        await controlOverlay.click();
    }

    await expect(page.locator('#canvas')).toBeVisible({ timeout: 30_000 });
    await expect
        .poll(async () => page.locator('html').getAttribute('data-tenant-metaverse-ready'), {
            timeout: 120_000,
        })
        .toBe('true');

    const fatal = consoleLines.filter(
        (t) =>
            t.includes('Maximum call stack size exceeded') ||
            t.includes('init failed') ||
            t.includes("Cannot read properties of undefined (reading 'image')"),
    );
    expect(fatal, `console fatal errors: ${fatal.join(' | ')}`).toEqual([]);

    await expect
        .poll(async () => page.locator('#world-name').textContent(), { timeout: 180_000 })
        .not.toBe('-');
    await expect(page.locator('#menu-bar')).toBeVisible();
}

/**
 * テナント URL へ遷移して初期化完了を待つ
 * @param {import('@playwright/test').Page} page
 * @param {string} [tenantId]
 */
export async function gotoTenantMetaverse(page, tenantId = TENANT_ID) {
    await installTenantE2EHarness(page);
    await page.goto(`/${tenantId}/`);
    await expectMetaverseReady(page);
}

/**
 * Socket.io 接続完了を待つ
 * @param {import('@playwright/test').Page} page
 */
export async function waitForSocketConnected(page) {
    let stableTicks = 0;
    await expect
        .poll(
            async () => {
                try {
                    const ready = await page.evaluate(() => {
                        const e2e = window.__tenantE2E;
                        const sock = e2e?.getSocket?.();
                        if (!sock?.connected) return false;
                        const ping = e2e?.getNetworkManager?.()?.getPingStatus?.();
                        if (ping?.reconnecting) return false;
                        return true;
                    });
                    if (!ready) {
                        stableTicks = 0;
                        return false;
                    }
                    stableTicks += 1;
                    return stableTicks >= 2;
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (msg.includes('Execution context was destroyed')) {
                        stableTicks = 0;
                        return false;
                    }
                    throw err;
                }
            },
            { timeout: 120_000 },
        )
        .toBe(true);
}

/**
 * Socket.io で ack 付きイベントを送る（__tenantE2E 必須）
 * @param {import('@playwright/test').Page} page
 * @param {string} event
 * @param {unknown} data
 * @param {number} [timeoutMs]
 */
export async function emitSocketAck(page, event, data = {}, timeoutMs = 15_000) {
    /** @type {unknown} */
    let ack;
    await expect
        .poll(
            async () => {
                try {
                    await waitForSocketConnected(page);
                    ack = await page.evaluate(
                        async ({ eventName, payload, timeout }) => {
                            const sock = window.__tenantE2E?.getSocket?.();
                            if (!sock?.connected) {
                                throw new Error('socket not connected');
                            }
                            return await new Promise((resolve, reject) => {
                                const timer = setTimeout(
                                    () => reject(new Error(`socket ack timeout: ${eventName}`)),
                                    timeout,
                                );
                                sock.emit(eventName, payload, (response) => {
                                    clearTimeout(timer);
                                    resolve(response);
                                });
                            });
                        },
                        { eventName: event, payload: data, timeout: timeoutMs },
                    );
                    return true;
                } catch (err) {
                    const msg = err instanceof Error ? err.message : String(err);
                    if (
                        msg.includes('socket not connected') ||
                        msg.includes('Execution context was destroyed')
                    ) {
                        return false;
                    }
                    throw err;
                }
            },
            { timeout: 120_000 },
        )
        .toBe(true);
    return ack;
}

/**
 * 管理画面からメタバース入場 token を取得
 * @param {import('@playwright/test').APIRequestContext} request
 */
export async function fetchAdminMetaverseToken(request) {
    const res = await request.get('/admin/enter-metaverse');
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(body.token).toBeTruthy();
    return body.token;
}

/**
 * 設定モーダルを開閉し、オーバーレイが消えてから次 UI 操作へ進む
 * @param {import('@playwright/test').Page} page
 */
export async function exerciseSettingsModalSmoke(page) {
    const settingsBtn = page.locator('#settings-btn');
    await expect(settingsBtn).toBeVisible();
    await settingsBtn.click();
    await expect(page.locator('#settings-modal.visible')).toBeVisible();
    await page.locator('#settings-close-btn').click();
    await expect(page.locator('#settings-modal.visible')).toHaveCount(0, { timeout: 15_000 });
}

/**
 * スタンプメニューを開く（重いワールド読込中はクリックをリトライ）
 * @param {import('@playwright/test').Page} page
 */
export async function openStampMenu(page) {
    const stampBtn = page.locator('#stamp-btn');
    const openMenu = page.locator('#emoji-menu.show');

    await expect(stampBtn).toBeVisible();
    await expect(stampBtn).toBeEnabled();

    await expect
        .poll(
            async () => {
                if (await openMenu.isVisible().catch(() => false)) {
                    return true;
                }
                await stampBtn.click({ timeout: 5_000 }).catch(() => {});
                return openMenu.isVisible().catch(() => false);
            },
            { timeout: 60_000, intervals: [250, 500, 1000] },
        )
        .toBe(true);
}
