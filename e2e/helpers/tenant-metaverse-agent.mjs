// e2e/helpers/tenant-metaverse-agent.mjs — AI / Cursor エージェント向けメタバース操作ヘルパー
import { expect } from '@playwright/test';
import {
    TENANT_ID,
    ADMIN_USER,
    installTenantE2EHarness,
    enableDeveloperMode,
    expectMetaverseReady,
    setGuestUsername,
    setAdminToken,
    waitForSocketConnected,
    fetchAdminMetaverseToken,
} from './tenant-metaverse.mjs';

export {
    TENANT_ID,
    ADMIN_USER,
    installTenantE2EHarness,
    enableDeveloperMode,
    waitForSocketConnected,
    fetchAdminMetaverseToken,
};

/**
 * 表示座標文字列を数値にパース
 * @param {string | null | undefined} text
 */
export function parsePositionDisplay(text) {
    if (!text) return null;
    const parts = text.split(',').map((s) => Number.parseFloat(s.trim()));
    if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
    return { x: parts[0], y: parts[1], z: parts[2] };
}

/**
 * ゲストとしてログイン（localStorage username を事前設定）
 * @param {import('@playwright/test').Page} page
 * @param {string} [username]
 */
export async function loginAsGuest(page, username) {
    const name = username?.trim() || `Agent-${Date.now()}`;
    await setGuestUsername(page, name);
    return name;
}

/**
 * 管理 token + 表示名で管理者として入場準備
 * @param {import('@playwright/test').Page} page
 * @param {import('@playwright/test').APIRequestContext} request
 * @param {string} [displayName]
 */
export async function loginAsAdmin(page, request, displayName = ADMIN_USER) {
    const token = await fetchAdminMetaverseToken(request);
    await setAdminToken(page, token);
    await setGuestUsername(page, displayName);
    return { token, displayName };
}

/**
 * 操作方式・モーダルなどブロッキング UI を閉じる
 * @param {import('@playwright/test').Page} page
 */
export async function dismissBlockingModals(page) {
    const keyboardBtn = page.locator('#control-scheme-keyboard-btn');
    if (await keyboardBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await keyboardBtn.click();
    }


    for (const selector of [
        '#settings-modal.visible #settings-close-btn',
        '#help-modal.visible #help-close-btn',
        '#restart-modal.visible #restart-modal-cancel-btn',
        '#logout-modal button[data-dismiss]',
    ]) {
        const btn = page.locator(selector).first();
        if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
            await btn.click();
        }
    }

    await page.keyboard.press('Escape').catch(() => {});
}

/**
 * document 向けに KeyboardEvent を送る（CharacterController は document リスナー）
 * @param {import('@playwright/test').Page} page
 * @param {string} code
 * @param {'down' | 'up'} phase
 */
async function dispatchKeyCode(page, code, phase) {
    await page.evaluate(
        ({ keyCode, keyPhase }) => {
            const type = keyPhase === 'down' ? 'keydown' : 'keyup';
            document.dispatchEvent(
                new KeyboardEvent(type, {
                    code: keyCode,
                    bubbles: true,
                    cancelable: true,
                }),
            );
        },
        { keyCode: code, keyPhase: phase },
    );
}

/**
 * ゲームプレイ用 canvas にフォーカス
 * @param {import('@playwright/test').Page} page
 */
export async function focusGameplayCanvas(page) {
    const canvas = page.locator('#canvas');
    await expect(canvas).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => {
        const active = document.activeElement;
        if (active && active !== document.body && typeof active.blur === 'function') {
            active.blur();
        }
    });
    await canvas.click({ position: { x: 320, y: 240 }, force: true });
}

/** @type {Record<string, string>} */
const KEY_TO_MOVEMENT_AXIS = {
    KeyW: 'forward',
    KeyS: 'backward',
    KeyA: 'left',
    KeyD: 'right',
};

/**
 * 初回入力で物理サスペンドを解除（IdleControlHint / spawn suspend）
 * @param {import('@playwright/test').Page} page
 */
export async function unlockGameplayPhysics(page) {
    await focusGameplayCanvas(page);
    await dispatchKeyCode(page, 'KeyW', 'down');
    await page.waitForTimeout(80);
    await dispatchKeyCode(page, 'KeyW', 'up');

    await expect
        .poll(
            async () =>
                page.evaluate(() => {
                    const e2e = window.__tenantE2E;
                    if (e2e?.isPhysicsSuspended) return !e2e.isPhysicsSuspended();
                    return true;
                }),
            { timeout: 10_000 },
        )
        .toBe(true);
}

/**
 * WASD 等のキー入力（canvas フォーカス後）
 * @param {import('@playwright/test').Page} page
 * @param {string[]} keys Playwright キー名（例: KeyW, KeyA）
 * @param {{ holdMs?: number }} [opts]
 */
export async function pressGameplayKeys(page, keys, opts = {}) {
    const holdMs = opts.holdMs ?? 0;
    await focusGameplayCanvas(page);
    for (const key of keys) {
        const axis = KEY_TO_MOVEMENT_AXIS[key];
        if (holdMs > 0 && axis) {
            const drove = await page
                .evaluate(
                    async ({ movementAxis, ms }) => {
                        const hold = window.__tenantE2E?.holdMovementForE2e;
                        if (!hold) return false;
                        await hold(movementAxis, ms);
                        return true;
                    },
                    { movementAxis: axis, ms: holdMs },
                )
                .catch(() => false);
            if (drove) {
                await dispatchKeyCode(page, key, 'down');
                await dispatchKeyCode(page, key, 'up');
                continue;
            }
        }
        if (holdMs > 0) {
            await dispatchKeyCode(page, key, 'down');
            await page.waitForTimeout(holdMs);
            await dispatchKeyCode(page, key, 'up');
        } else {
            await dispatchKeyCode(page, key, 'down');
            await dispatchKeyCode(page, key, 'up');
        }
    }
}

/**
 * Pointer Lock を要求（失敗時は false — headless では未対応のことが多い）
 * @param {import('@playwright/test').Page} page
 */
export async function requestPointerLockIfNeeded(page) {
    return page.evaluate(async () => {
        const canvas = document.querySelector('#canvas');
        if (!canvas) return { requested: false, locked: false, reason: 'no-canvas' };
        if (document.pointerLockElement === canvas) {
            return { requested: false, locked: true, reason: 'already-locked' };
        }
        try {
            await canvas.requestPointerLock();
            return {
                requested: true,
                locked: document.pointerLockElement === canvas,
                reason: document.pointerLockElement ? 'ok' : 'not-granted',
            };
        } catch (err) {
            return {
                requested: true,
                locked: false,
                reason: err instanceof Error ? err.message : String(err),
            };
        }
    });
}

/**
 * シーン / ネットワークのデバッグ情報
 * @param {import('@playwright/test').Page} page
 */
export async function getSceneDebugInfo(page) {
    const hudPosition = parsePositionDisplay(await page.locator('#position-display').textContent());
    const evaluated = await page.evaluate(() => {
        const e2e = window.__tenantE2E;
        const sock = e2e?.getSocket?.();
        return {
            harness: Boolean(e2e),
            worldId: e2e?.getCurrentWorldId?.() ?? null,
            position: e2e?.getLocalPosition?.() ?? null,
            physicsSuspended: e2e?.isPhysicsSuspended?.() ?? null,
            socketConnected: Boolean(sock?.connected),
            socketId: sock?.id ?? null,
            playerCountText: document.querySelector('#player-count')?.textContent?.trim() ?? '',
            worldName: document.querySelector('#world-name')?.textContent?.trim() ?? '',
            ready: document.documentElement.dataset.tenantMetaverseReady === 'true',
        };
    });
    return {
        ...evaluated,
        hudPosition,
        position: evaluated.position ?? hudPosition,
    };
}

/**
 * テナント URL へ入場し操作可能状態まで進める
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   tenantId?: string;
 *   username?: string;
 *   developerMode?: boolean;
 *   unlockPhysics?: boolean;
 *   waitSocket?: boolean;
 * }} [options]
 */
export async function enterWorld(page, options = {}) {
    const tenantId = options.tenantId ?? TENANT_ID;
    const unlockPhysics = options.unlockPhysics !== false;
    const waitSocket = options.waitSocket !== false;

    await installTenantE2EHarness(page);
    if (options.developerMode) {
        await enableDeveloperMode(page);
    }

    const username = options.username
        ? await loginAsGuest(page, options.username)
        : await loginAsGuest(page);

    await page.goto(`/${tenantId}/`);
    await expectMetaverseReady(page);
    await dismissBlockingModals(page);

    if (unlockPhysics) {
        await unlockGameplayPhysics(page);
    }
    if (waitSocket) {
        await waitForSocketConnected(page);
    }

    return { tenantId, username };
}

/**
 * ローカル座標が threshold 以上動くまで待つ
 * @param {import('@playwright/test').Page} page
 * @param {number} minDelta
 * @param {number} [timeoutMs]
 */
export async function waitForLocalMovement(page, minDelta = 0.05, timeoutMs = 20_000) {
    const start = await getSceneDebugInfo(page);
    const startPos = start.position;
    if (!startPos) {
        throw new Error('getSceneDebugInfo: position unavailable');
    }

    await expect
        .poll(
            async () => {
                const info = await getSceneDebugInfo(page);
                const pos = info.position;
                if (!pos) return 0;
                const dx = pos.x - startPos.x;
                const dz = pos.z - startPos.z;
                return Math.hypot(dx, dz);
            },
            { timeout: timeoutMs },
        )
        .toBeGreaterThan(minDelta);
}
