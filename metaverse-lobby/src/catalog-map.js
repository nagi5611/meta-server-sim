/**
 * Admin UI world ↔ sim catalog entry
 * @param {Record<string, unknown>} entry
 */
export function entryToWorld(entry, live = {}) {
    const id = String(entry.id || '');
    let status = String(entry.lobbyStatus || (entry.maintenance ? 'maint' : 'open'));
    if (status === 'live') status = 'event';
    return {
        id,
        name: String(entry.name || ''),
        url: String(entry.entryUrl || ''),
        code: String(entry.joinCode || ''),
        thumb: String(entry.thumbnailUrl || ''),
        desc: String(entry.description || ''),
        status,
        audience: String(entry.audience || 'all'),
        cap: Number(entry.capacity ?? 0) || 0,
        players: Number(live.players ?? 0) || 0,
        updated: String(entry.updatedAt || live.statusAt || new Date().toISOString()),
        tenantId: entry.tenantId || null,
        enabled: entry.enabled !== false,
    };
}

/**
 * @param {Record<string, unknown>} w
 */
export function worldToEntry(w, prev = {}) {
    const status = String(w.status || 'open');
    const maintenance = status === 'maint';
    return {
        id: String(w.id || prev.id || ''),
        name: String(w.name || '').trim(),
        entryUrl: String(w.url || w.entryUrl || '').trim(),
        joinCode: String(w.code || w.joinCode || '').trim().toUpperCase() || undefined,
        thumbnailUrl: String(w.thumb || w.thumbnailUrl || '').trim() || undefined,
        description: String(w.desc || w.description || ''),
        maintenance,
        lobbyStatus: status === 'event' ? 'event' : maintenance ? 'maint' : 'open',
        audience: ['all', 'signed', 'admin'].includes(String(w.audience)) ? String(w.audience) : 'all',
        capacity: Number(w.cap ?? w.capacity) || undefined,
        sortOrder: prev.sortOrder ?? 0,
        enabled: w.enabled !== false,
        tenantId: prev.tenantId || w.tenantId || undefined,
        statusUrl: prev.statusUrl,
        presenceUrl: prev.presenceUrl,
    };
}