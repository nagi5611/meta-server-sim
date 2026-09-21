// lib/tenant-admin-kick.js — 管理者キック（Socket 検証・レート制限）

import { createFixedWindowCounter, isHttpRateLimitDisabled } from './http-rate-limit.js';

/** @type {string} */
export const ADMIN_KICK_MESSAGE = '管理者によってキックされました。';

/** @type {number} */
export const ADMIN_KICK_RATE_LIMIT_WINDOW_MS = 60_000;

/** @type {number} */
export const ADMIN_KICK_RATE_LIMIT_MAX = 15;

const adminKickRateCounter = createFixedWindowCounter({
    windowMs: ADMIN_KICK_RATE_LIMIT_WINDOW_MS,
    max: ADMIN_KICK_RATE_LIMIT_MAX,
});

/** @type {Record<string, string>} */
export const ADMIN_KICK_ERROR_MESSAGES = {
    forbidden: '管理者権限が必要です。',
    invalid_target: 'キックできないプレイヤーです。',
    not_found: 'プレイヤーが見つかりません。',
    cannot_kick_admin: '管理者はキックできません。',
    rate_limited: 'キック操作が多すぎます。しばらく待ってから再試行してください。',
};

/**
 * 管理者キック拒否コードのユーザー向け文言を返す
 * @param {string} code
 * @returns {string}
 */
export function getAdminKickErrorMessage(code) {
    return ADMIN_KICK_ERROR_MESSAGES[code] || 'キックに失敗しました。';
}

/**
 * 管理者キック要求を検証する
 * @param {import('socket.io').Socket} adminSocket
 * @param {unknown} targetSocketId
 * @param {import('socket.io').Socket | undefined} targetSocket
 * @param {string} tenantId
 * @returns {'forbidden'|'invalid_target'|'not_found'|'cannot_kick_admin'|null}
 */
export function validateAdminKickRequest(adminSocket, targetSocketId, targetSocket, tenantId) {
    if (!adminSocket.data?.isAdmin) return 'forbidden';
    if (typeof targetSocketId !== 'string' || !targetSocketId.trim()) return 'invalid_target';
    if (targetSocketId === adminSocket.id) return 'invalid_target';
    if (!targetSocket?.connected) return 'not_found';
    if (targetSocket.data?.tenantId !== tenantId) return 'not_found';
    if (targetSocket.data?.isAdmin) return 'cannot_kick_admin';
    return null;
}

/**
 * 管理者ソケットのキック試行レート制限（試行ごとに 1 カウント）
 * @param {string} adminSocketId
 * @returns {'rate_limited'|null}
 */
export function checkAndRecordAdminKickRateLimit(adminSocketId) {
    if (isHttpRateLimitDisabled()) return null;
    const key = String(adminSocketId || '').trim();
    if (!key || !adminKickRateCounter.tryConsume(key)) return 'rate_limited';
    return null;
}

/**
 * レート制限と検証をまとめて実行する
 * @param {import('socket.io').Socket} adminSocket
 * @param {unknown} targetSocketId
 * @param {import('socket.io').Socket | undefined} targetSocket
 * @param {string} tenantId
 * @returns {'forbidden'|'invalid_target'|'not_found'|'cannot_kick_admin'|'rate_limited'|null}
 */
export function resolveAdminKickPlayerRequest(adminSocket, targetSocketId, targetSocket, tenantId) {
    const rateError = checkAndRecordAdminKickRateLimit(adminSocket.id);
    if (rateError) return rateError;
    return validateAdminKickRequest(adminSocket, targetSocketId, targetSocket, tenantId);
}

/**
 * 管理者キック結果ペイロードを組み立てる
 * @param {'forbidden'|'invalid_target'|'not_found'|'cannot_kick_admin'|'rate_limited'} errorCode
 * @returns {{ ok: false, error: string, message: string }}
 */
export function buildAdminKickRejectionPayload(errorCode) {
    return {
        ok: false,
        error: errorCode,
        message: getAdminKickErrorMessage(errorCode),
    };
}

/**
 * admin-kick-player の応答を管理者クライアントへ返す
 * @param {import('socket.io').Socket} adminSocket
 * @param {{ ok: true } | { ok: false, error: string, message: string }} payload
 * @param {((payload: unknown) => void) | undefined} [callback]
 */
export function replyAdminKickPlayer(adminSocket, payload, callback) {
    if (typeof callback === 'function') {
        callback(payload);
        return;
    }
    if (!payload.ok) {
        adminSocket.emit('admin-kick-rejected', payload);
    }
}

/**
 * キック通知を送ってから切断する
 * @param {import('socket.io').Socket} targetSocket
 * @param {string} [message]
 */
export function applyAdminKickToSocket(targetSocket, message = ADMIN_KICK_MESSAGE) {
    targetSocket.emit('admin-kicked', { message });
    setTimeout(() => {
        try {
            targetSocket.disconnect(true);
        } catch {
            /* ignore */
        }
    }, 100);
}

/** @internal ユニットテスト用 */
export function resetAdminKickRateLimitForTests() {
    adminKickRateCounter.resetForTests();
}
