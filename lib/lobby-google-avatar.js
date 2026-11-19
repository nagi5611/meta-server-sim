const SAFE_PROFILE_AVATAR_NAME = /^(student|teacher)-\d+\.(jpe?g|png|webp)$/i;

/**
 * User-uploaded lobby avatars are served from R2 via /api/assets/profile-avatars/…
 * @param {string} url
 */
export function isLobbyHostedAvatarUrl(url) {
    const u = String(url || '').trim();
    if (!u) return false;
    const path = u.includes('://') ? (() => {
        try {
            return new URL(u).pathname;
        } catch {
            return u;
        }
    })() : u;
    const name = path.split('/').pop() || '';
    return SAFE_PROFILE_AVATAR_NAME.test(name) || path.includes('/api/assets/profile-avatars/');
}

/**
 * @param {string} url
 */
export function normalizeGooglePictureUrl(url) {
    const u = String(url || '').trim();
    if (!u || u.length > 512) return '';
    if (!/^https:\/\//i.test(u)) return '';
    if (!/googleusercontent\.com|ggpht\.com/i.test(u)) return '';
    return u;
}

/**
 * @param {string} existingAvatarUrl
 * @param {string} pictureUrl
 */
export function shouldSyncGoogleAvatar(existingAvatarUrl, pictureUrl) {
    const existing = String(existingAvatarUrl || '').trim();
    const pic = normalizeGooglePictureUrl(pictureUrl);
    if (!pic) return false;
    if (!existing) return true;
    if (isLobbyHostedAvatarUrl(existing)) return false;
    return existing !== pic;
}

/**
 * @param {string} existingAvatarUrl
 * @param {string} pictureUrl
 * @returns {string | null}
 */
export function googleAvatarUrlToStore(existingAvatarUrl, pictureUrl) {
    const pic = normalizeGooglePictureUrl(pictureUrl);
    if (!pic) return null;
    if (!shouldSyncGoogleAvatar(existingAvatarUrl, pic)) return null;
    return pic;
}