// public/js/tenant-planned-restart-alert.js — 計画再起動の全プレイヤー向けアラート
import { toTenantUrl } from './tenant-runtime-shim.js';

const SOCKET_EVENT = 'platform:planned-restart';
const SOCKET_CLEAR_EVENT = 'platform:planned-restart-clear';

/** @type {ReturnType<typeof setInterval> | null} */
let countdownTimer = null;

/** @type {{ restartAtMs: number, message: string } | null} */
let activeState = null;

/**
 * 残り時間を人が読める形式にする
 * @param {number} restartAtMs
 */
function formatRemaining(restartAtMs) {
    const sec = Math.max(0, Math.ceil((restartAtMs - Date.now()) / 1000));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m > 0) {
        return `あと ${m} 分 ${s} 秒でサーバーが再起動します`;
    }
    return `あと ${s} 秒でサーバーが再起動します`;
}

/**
 * バナー DOM を更新する
 */
function refreshBannerDom() {
    const banner = document.getElementById('platform-planned-restart-banner');
    const messageEl = document.getElementById('platform-planned-restart-message');
    const countdownEl = document.getElementById('platform-planned-restart-countdown');
    if (!banner || !messageEl || !countdownEl) {
        return;
    }
    if (!activeState || Date.now() >= activeState.restartAtMs) {
        banner.hidden = true;
        banner.setAttribute('aria-hidden', 'true');
        return;
    }
    messageEl.textContent = activeState.message;
    countdownEl.textContent = formatRemaining(activeState.restartAtMs);
    banner.hidden = false;
    banner.setAttribute('aria-hidden', 'false');
}

/**
 * カウントダウンタイマーを開始する
 */
function ensureCountdownTimer() {
    if (countdownTimer) {
        return;
    }
    countdownTimer = setInterval(() => {
        refreshBannerDom();
        if (!activeState || Date.now() >= activeState.restartAtMs) {
            if (countdownTimer) {
                clearInterval(countdownTimer);
                countdownTimer = null;
            }
        }
    }, 1000);
}

/**
 * 計画再起動アラートを適用する
 * @param {{ restartAtMs?: number, message?: string } | null | undefined} payload
 */
export function applyPlannedRestartAlert(payload) {
    if (!payload?.restartAtMs || !payload.message) {
        hidePlannedRestartAlert();
        return;
    }
    if (Date.now() >= payload.restartAtMs) {
        hidePlannedRestartAlert();
        return;
    }
    activeState = {
        restartAtMs: payload.restartAtMs,
        message: String(payload.message),
    };
    refreshBannerDom();
    ensureCountdownTimer();
}

/**
 * アラートを非表示にする
 */
export function hidePlannedRestartAlert() {
    activeState = null;
    if (countdownTimer) {
        clearInterval(countdownTimer);
        countdownTimer = null;
    }
    refreshBannerDom();
}

/**
 * Socket.io で計画再起動通知を受け取る
 * @param {import('socket.io-client').Socket | null | undefined} socket
 */
export function attachPlannedRestartSocketListeners(socket) {
    if (!socket) {
        return;
    }
    socket.on(SOCKET_EVENT, (payload) => {
        applyPlannedRestartAlert(payload);
    });
    socket.on(SOCKET_CLEAR_EVENT, () => {
        hidePlannedRestartAlert();
    });
}

/**
 * client-config の plannedRestart を反映する
 * @param {{ plannedRestart?: { restartAtMs: number, message: string } | null }} config
 */
export function applyPlannedRestartFromClientConfig(config) {
    applyPlannedRestartAlert(config?.plannedRestart ?? null);
}

/**
 * client-config から計画再起動を取得して表示する（Socket 接続前の遅延参加者向け）
 */
export async function ensurePlannedRestartFromClientConfig() {
    try {
        const res = await fetch(toTenantUrl('/api/client-config'), {
            credentials: 'include',
            cache: 'no-store',
        });
        if (!res.ok) {
            return;
        }
        const data = await res.json();
        applyPlannedRestartFromClientConfig(data);
    } catch {
        /* ignore */
    }
}
