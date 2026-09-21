// lib/fds-smoke-origin-match.js — バルク公開オリジンとブラウザオリジンの一致判定

/**
 * バルク公開オリジンが現在ページと一致するか（スキームも含む）
 * @param {string | null | undefined} origin
 * @param {string | undefined} pageOrigin
 * @returns {boolean}
 */
export function fdsSmokeBulkOriginMatchesPage(origin, pageOrigin) {
    if (!origin || !pageOrigin) {
        return false;
    }
    try {
        return new URL(origin).origin === pageOrigin;
    } catch {
        return false;
    }
}
