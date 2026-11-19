// Public lobby UI origin (Cloudflare Pages: m.mmh-virtual.jp)

const PRODUCTION_LOBBY_ORIGIN = 'https://m.mmh-virtual.jp';
/** wrangler dev default */
const DEV_LOBBY_ORIGIN = 'http://127.0.0.1:8787';

/**
 * @param {string} raw
 * @returns {string}
 */
export function normalizeLobbyPublicUrl(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    try {
        const u = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
        u.pathname = '/';
        u.search = '';
        u.hash = '';
        return u.href;
    } catch {
        return '';
    }
}

/**
 * Sim / client-config 用のロビー URL（末尾スラッシュ付き origin）
 * @returns {string}
 */
export function resolveLobbyPublicUrl() {
    const fromEnv = normalizeLobbyPublicUrl(process.env.LOBBY_PUBLIC_URL || '');
    if (fromEnv) return fromEnv;

    const isProd = String(process.env.NODE_ENV || '').trim() === 'production';
    if (isProd) return `${PRODUCTION_LOBBY_ORIGIN}/`;

    const devOverride = normalizeLobbyPublicUrl(
        process.env.VITE_LOBBY_URL || process.env.LOBBY_PUBLIC_URL_DEV || '',
    );
    if (devOverride) return devOverride;

    return `${DEV_LOBBY_ORIGIN}/`;
}