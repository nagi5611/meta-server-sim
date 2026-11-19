/** Shared lobby card/status helpers for public + admin preview */
export const ST_TEXT = { open: '稼働中', live: 'イベント中', event: 'イベント中', maint: 'メンテナンス中', degraded: '診断中', online: '稼働中' };

export function lobbyAudienceVisible(world, viewer) {
    const a = String(world?.audience || 'all');
    if (a === 'all') return true;
    if (a === 'signed') return viewer === 'signed' || viewer === 'admin';
    return viewer === 'admin';
}

export function normalizeLobbyStatus(status, maintenance) {
    if (maintenance) return 'maint';
    const s = String(status || 'online');
    if (s === 'live' || s === 'event') return 'event';
    if (s === 'maint') return 'maint';
    if (s === 'degraded') return 'maint';
    return 'open';
}

export function escapeLobbyHtml(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}