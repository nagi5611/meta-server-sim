/**
 * Parse lobby/API timestamps into a Date for local display.
 * Servers normally emit ISO-8601 with `Z`; legacy values without a zone are treated as UTC.
 * @param {unknown} raw
 * @returns {Date}
 */
export function parseLobbyInstant(raw) {
    if (raw == null || raw === '') return new Date();
    if (typeof raw === 'number' && Number.isFinite(raw)) {
        return new Date(raw < 1e12 ? raw * 1000 : raw);
    }
    const s = String(raw).trim();
    if (!s) return new Date();
    if (/^\d+$/.test(s)) {
        const n = Number(s);
        return new Date(n < 1e12 ? n * 1000 : n);
    }
    if (/[zZ]|[+\-]\d{2}:?\d{2}$/.test(s)) {
        const d = new Date(s);
        return Number.isNaN(d.getTime()) ? new Date() : d;
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const d = new Date(`${s}T00:00:00Z`);
        return Number.isNaN(d.getTime()) ? new Date() : d;
    }
    const normalized = s.includes('T') ? `${s}Z` : `${s.replace(' ', 'T')}Z`;
    const d = new Date(normalized);
    return Number.isNaN(d.getTime()) ? new Date() : d;
}

/**
 * @param {Date} date
 * @param {Intl.DateTimeFormatOptions} [extra]
 */
export function formatLobbyLocalTime(date, extra = {}) {
    const d = date instanceof Date ? date : parseLobbyInstant(date);
    if (Number.isNaN(d.getTime())) return '—';
    return new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
        ...extra,
    }).format(d);
}