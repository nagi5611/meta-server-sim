/** Lobby announcement locale helpers (aligned with public/i18n.js SUPPORTED). */

export const ANNOUNCEMENT_LOCALES = ['ja', 'zh-CN', 'zh-TW', 'en'];

/**
 * @param {string} tag
 * @returns {'ja' | 'zh-CN' | 'zh-TW' | 'en'}
 */
export function normalizeAnnouncementLocale(tag) {
    const t = String(tag || '').trim();
    if (!t) return 'ja';
    const lower = t.toLowerCase();
    if (lower === 'zh-tw' || lower === 'zh-hk' || lower === 'zh-hant') return 'zh-TW';
    if (lower === 'zh-cn' || lower === 'zh' || lower.startsWith('zh-')) return 'zh-CN';
    if (lower.startsWith('en')) return 'en';
    if (lower.startsWith('ja')) return 'ja';
    if (t === 'zh-CN' || t === 'zh-TW') return /** @type {'zh-CN' | 'zh-TW'} */ (t);
    return 'ja';
}

/**
 * @param {Request} request
 * @param {URL} url
 */
export function resolveClientLocale(request, url) {
    const q = url.searchParams.get('locale');
    if (q) return normalizeAnnouncementLocale(q);
    const accept = request.headers.get('accept-language') || '';
    const first = accept.split(',')[0]?.split(';')[0]?.trim();
    if (first) return normalizeAnnouncementLocale(first);
    return 'ja';
}

/**
 * @param {Record<string, { title?: string, body?: string }> | null | undefined} i18n
 * @param {string} locale
 * @param {{ title: string, body: string }} fallback
 */
export function pickAnnouncementText(i18n, locale, fallback) {
    const loc = normalizeAnnouncementLocale(locale);
    const hit = i18n?.[loc];
    const title =
        typeof hit?.title === 'string' && hit.title.trim() ? hit.title.trim() : fallback.title;
    const body = typeof hit?.body === 'string' && hit.body.trim() ? hit.body.trim() : fallback.body;
    return { title, body };
}

/**
 * @param {unknown} raw
 * @returns {Record<string, { title: string, body: string }> | null}
 */
export function parseAnnouncementI18nJson(raw) {
    if (raw == null || raw === '') return null;
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!parsed || typeof parsed !== 'object') return null;
        /** @type {Record<string, { title: string, body: string }>} */
        const out = {};
        for (const [key, val] of Object.entries(/** @type {Record<string, unknown>} */ (parsed))) {
            if (!val || typeof val !== 'object') continue;
            const v = /** @type {Record<string, unknown>} */ (val);
            out[key] = {
                title: String(v.title || ''),
                body: String(v.body || ''),
            };
        }
        return Object.keys(out).length ? out : null;
    } catch {
        return null;
    }
}

/**
 * @param {Record<string, { title?: string, body?: string }> | null | undefined} base
 * @param {Record<string, { title?: string, body?: string }> | null | undefined} overrides
 * @returns {Record<string, { title: string, body: string }>}
 */
export function mergeAnnouncementI18nOverrides(base, overrides) {
    /** @type {Record<string, { title: string, body: string }>} */
    const out = {};
    const seed = base && typeof base === 'object' ? base : {};
    for (const code of ANNOUNCEMENT_LOCALES) {
        const hit = seed[code];
        out[code] = {
            title: typeof hit?.title === 'string' ? hit.title.trim() : '',
            body: '',
        };
    }
    if (!overrides || typeof overrides !== 'object') return out;
    for (const [loc, val] of Object.entries(overrides)) {
        if (!val || typeof val !== 'object') continue;
        const norm = normalizeAnnouncementLocale(loc);
        if (!ANNOUNCEMENT_LOCALES.includes(norm)) continue;
        const t = String(/** @type {{ title?: unknown }} */ (val).title ?? '').trim();
        if (t) out[norm] = { title: t, body: '' };
    }
    return out;
}

/**
 * @param {unknown} raw
 * @returns {Record<string, { title: string, body: string }> | null}
 */
export function parseAdminAnnouncementI18n(raw) {
    if (raw == null) return null;
    let parsed = raw;
    if (typeof raw === 'string') {
        try {
            parsed = JSON.parse(raw);
        } catch {
            return null;
        }
    }
    if (!parsed || typeof parsed !== 'object') return null;
    /** @type {Record<string, { title: string, body: string }>} */
    const out = {};
    for (const [loc, val] of Object.entries(/** @type {Record<string, unknown>} */ (parsed))) {
        if (!val || typeof val !== 'object') continue;
        const norm = normalizeAnnouncementLocale(loc);
        if (!ANNOUNCEMENT_LOCALES.includes(norm)) continue;
        const v = /** @type {Record<string, unknown>} */ (val);
        if (v.title === undefined) continue;
        out[norm] = { title: String(v.title || '').trim(), body: '' };
    }
    return Object.keys(out).length ? out : null;
}