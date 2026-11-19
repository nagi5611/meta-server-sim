/**
 * Lobby status/presence URLs are platform-scoped (origin + /api/lobby/*), not per-tenant paths.
 * @param {{ entryUrl?: string, statusUrl?: string, presenceUrl?: string }} entry
 */
export function resolveLobbyPollUrls(entry) {
    const entryUrl = String(entry?.entryUrl || '').trim();
    try {
        const origin = new URL(entryUrl).origin;
        return {
            statusUrl: `${origin}/api/lobby/status`,
            presenceUrl: `${origin}/api/lobby/presence`,
        };
    } catch {
        return {
            statusUrl: entry?.statusUrl != null ? String(entry.statusUrl).trim() : undefined,
            presenceUrl: entry?.presenceUrl != null ? String(entry.presenceUrl).trim() : undefined,
        };
    }
}

/** @param {Record<string, unknown>} world */
export function normalizeRegistryMetaverse(world) {
    const urls = resolveLobbyPollUrls(world);
    return {
        ...world,
        statusUrl: urls.statusUrl ?? null,
        presenceUrl: urls.presenceUrl ?? null,
    };
}

/**
 * @param {{ status?: string }} prev
 */
export function statusAfterPresenceSuccess(prev) {
    const s = String(prev?.status || '');
    if (s === 'maint' || s === 'live') return s;
    if (!s || s === 'degraded') return 'online';
    return s;
}