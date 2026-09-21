// lib/platform-planned-restart.js — 管理パネルからの計画再起動と全テナント通知

export const PLANNED_RESTART_SOCKET_EVENT = 'platform:planned-restart';
export const PLANNED_RESTART_CLEAR_SOCKET_EVENT = 'platform:planned-restart-clear';

const MIN_DELAY_MS = 5_000;
const MAX_DELAY_MS = 24 * 60 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 500;

/** @type {{ restartAtMs: number, message: string, scheduledAtMs: number } | null} */
let activePlannedRestart = null;

/** @type {ReturnType<typeof setTimeout> | null} */
let restartTimer = null;

/** @type {((event: string, payload: object) => void) | null} */
let broadcastFn = null;

/**
 * 全テナント Socket へイベントを送る関数を登録する
 * @param {(event: string, payload: object) => void} fn
 */
export function registerPlannedRestartBroadcast(fn) {
    broadcastFn = fn;
}

/**
 * @param {string} event
 * @param {object} payload
 */
function broadcast(event, payload) {
    if (broadcastFn) {
        broadcastFn(event, payload);
    }
}

/**
 * 計画再起動の公開状態（クライアント向け）
 * @returns {{ restartAtMs: number, message: string } | null}
 */
export function getPlannedRestartPublicState() {
    if (!activePlannedRestart) {
        return null;
    }
    if (Date.now() >= activePlannedRestart.restartAtMs) {
        return null;
    }
    return {
        restartAtMs: activePlannedRestart.restartAtMs,
        message: activePlannedRestart.message,
    };
}

/**
 * 遅延秒数を正規化する
 * @param {unknown} minutesRaw
 * @param {unknown} secondsRaw
 * @returns {{ delayMs: number } | { error: string }}
 */
export function normalizePlannedRestartDelay(minutesRaw, secondsRaw) {
    const minutes = Number.isFinite(Number(minutesRaw)) ? Math.max(0, Math.floor(Number(minutesRaw))) : 0;
    const seconds = Number.isFinite(Number(secondsRaw)) ? Math.max(0, Math.floor(Number(secondsRaw))) : 0;
    const delayMs = minutes * 60_000 + seconds * 1000;
    if (delayMs < MIN_DELAY_MS) {
        return {
            error: `再起動までの時間は最低 ${Math.ceil(MIN_DELAY_MS / 1000)} 秒必要です`,
        };
    }
    if (delayMs > MAX_DELAY_MS) {
        return { error: '再起動までの時間は 24 時間以内にしてください' };
    }
    return { delayMs };
}

/**
 * アラート文言を正規化する
 * @param {unknown} messageRaw
 * @returns {{ message: string } | { error: string }}
 */
export function normalizePlannedRestartMessage(messageRaw) {
    const message = String(messageRaw ?? '').trim();
    if (!message) {
        return { error: 'プレイヤー向けアラートメッセージを入力してください' };
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
        return { error: `メッセージは ${MAX_MESSAGE_LENGTH} 文字以内にしてください` };
    }
    return { message };
}

/**
 * 計画再起動をキャンセルする
 */
export function cancelPlannedPlatformRestart() {
    if (restartTimer) {
        clearTimeout(restartTimer);
        restartTimer = null;
    }
    if (activePlannedRestart) {
        activePlannedRestart = null;
        broadcast(PLANNED_RESTART_CLEAR_SOCKET_EVENT, {});
    }
}

/**
 * 計画再起動を予約する
 * @param {{ delayMs: number, message: string }}
 * @returns {{ restartAtMs: number, message: string }}
 */
export function schedulePlannedPlatformRestart({ delayMs, message }) {
    cancelPlannedPlatformRestart();

    const restartAtMs = Date.now() + delayMs;
    activePlannedRestart = {
        restartAtMs,
        message,
        scheduledAtMs: Date.now(),
    };

    const payload = { restartAtMs, message };
    broadcast(PLANNED_RESTART_SOCKET_EVENT, payload);

    restartTimer = setTimeout(() => {
        restartTimer = null;
        activePlannedRestart = null;
        console.log('[platform-planned-restart] executing scheduled restart');
        void import('./platform-reload.js').then(({ requestPlatformRestart }) => requestPlatformRestart());
    }, delayMs);
    restartTimer.unref?.();

    console.log(
        `[platform-planned-restart] scheduled in ${delayMs}ms (at ${new Date(restartAtMs).toISOString()})`
    );

    return payload;
}

/**
 * 即時再起動（計画があればキャンセル）
 */
export function requestForcePlatformRestart() {
    cancelPlannedPlatformRestart();
    void import('./platform-reload.js').then(({ requestPlatformRestart }) => requestPlatformRestart());
}
