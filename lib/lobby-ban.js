/**
 * Lobby user ban: optional expiry and effective active state.
 */

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