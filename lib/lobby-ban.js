/**
 * Lobby user ban: optional expiry and effective active state.
 */

/** @type {string} */
export const LOBBY_BAN_CONTACT_EMAIL = 'developer@mmh-virtual.jp';

/**
 * Japanese label for ban expiry in notifications (null/empty = permanent).
 * @param {string | null | undefined} banExpiresAt
 */
export function formatBanExpiryLabelJa(banExpiresAt) {
    if (banExpiresAt == null || String(banExpiresAt).trim() === '') {
        return '無期限';
    }
    const ms = Date.parse(String(banExpiresAt));
    if (!Number.isFinite(ms)) return '無期限';
    return new Intl.DateTimeFormat('ja-JP', {
        timeZone: 'Asia/Tokyo',
        year: 'numeric',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(new Date(ms));
}

/**
 * @param {string | null | undefined} banExpiresAt
 */
export function buildLobbyBanNotificationText(banExpiresAt) {
    const date = formatBanExpiryLabelJa(banExpiresAt);
    return `あなたはバンされました。予定解除日は${date}です。問い合わせ先は ${LOBBY_BAN_CONTACT_EMAIL} まで`;
}

/**
 * @param {unknown} input
 * @returns {string | null | undefined}
 */
export function normalizeBanExpiresAt(input) {
    if (input === undefined) return undefined;
    if (input === null || input === '') return null;
    const raw = String(input).trim();
    if (!raw) return null;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms)) return null;
    return new Date(ms).toISOString();
}

/**
 * @param {boolean | number | undefined} banned
 * @param {string | null | undefined} banExpiresAt
 * @param {number} [nowMs]
 */
export function isBanActive(banned, banExpiresAt, nowMs = Date.now()) {
    if (!banned) return false;
    const expires = banExpiresAt != null && String(banExpiresAt).trim() !== '' ? String(banExpiresAt) : null;
    if (!expires) return true;
    const end = Date.parse(expires);
    if (!Number.isFinite(end)) return true;
    return end > nowMs;
}

/**
 * @param {boolean | number} banned
 * @param {string | null | undefined} banExpiresAt
 * @param {number} [nowMs]
 * @returns {'active' | 'expired' | 'none'}
 */
export function banLifecycleState(banned, banExpiresAt, nowMs = Date.now()) {
    if (!banned) return 'none';
    if (isBanActive(banned, banExpiresAt, nowMs)) return 'active';
    return 'expired';
}