// public/js/tenant-lobby-exit.js — メタバース退出後のロビー URL

import { loadClientConfigOnce } from './tenant-client-config.js';

const PRODUCTION_LOBBY_ORIGIN = 'https://m.mmh-virtual.jp';
const DEV_LOBBY_ORIGIN = 'http://127.0.0.1:8787';

/**
 * 開発 Vite（HTTP）上で https://localhost リンクを開けるよう scheme を揃える
 * @param {string} url
 * @returns {string}
 */
function toReachableLobbyHref(url) {
    try {
        const u = new URL(url, window.location.origin);
        const isLocal = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
        if (isLocal && window.location.protocol === 'http:' && u.protocol === 'https:') {
            u.protocol = 'http:';
            return u.href;
        }
        return u.href;
    } catch {
        return url;
    }
}

/**
 * @param {string} raw
 * @returns {string}
 */
function normalizeLobbyUrl(raw) {
    const trimmed = String(raw || '').trim();
    if (!trimmed) return '';
    try {
        const u = new URL(trimmed.includes('://') ? trimmed : `https://${trimmed}`);
        u.pathname = '/';
        u.search = '';
        u.hash = '';
        return u.href;
    } catch {
        return '';
    }
}

function isLocalHost(hostname) {
    return hostname === 'localhost' || hostname === '127.0.0.1';
}

function isLobbyHostname(hostname) {
    if (!hostname) return false;
    if (isLocalHost(hostname)) return true;
    return hostname === 'm.mmh-virtual.jp' || hostname.endsWith('.pages.dev');
}

/**
 * ビルド時 Vite env / ホストヒューリスティック（client-config 未読込時）
 * @returns {string}
 */
export function getLobbyExitUrlFallback() {
    const viteLobby =
        typeof import.meta !== 'undefined' && import.meta.env
            ? String(import.meta.env.VITE_LOBBY_URL || '').trim()
            : '';
    const fromVite = normalizeLobbyUrl(viteLobby);
    if (fromVite) return fromVite;

    if (isLocalHost(window.location.hostname)) {
        return `${DEV_LOBBY_ORIGIN}/`;
    }
    return `${PRODUCTION_LOBBY_ORIGIN}/`;
}

/**
 * document.referrer がロビーならその origin を優先（同一タブ遷移のフォールバック）
 * @returns {string | null}
 */
function lobbyUrlFromReferrer() {
    try {
        const ref = String(document.referrer || '').trim();
        if (!ref) return null;
        const u = new URL(ref);
        if (!isLobbyHostname(u.hostname)) return null;
        return `${u.origin}/`;
    } catch {
        return null;
    }
}

/**
 * ログアウト後の遷移先ロビー URL
 * @returns {Promise<string>}
 */
export async function resolveLobbyExitUrl() {
    try {
        const data = await loadClientConfigOnce();
        const configured = normalizeLobbyUrl(data?.lobbyPublicUrl);
        if (configured) return toReachableLobbyHref(configured);
    } catch {
        /* ignore */
    }

    const fromReferrer = lobbyUrlFromReferrer();
    if (fromReferrer) return toReachableLobbyHref(fromReferrer);

    return toReachableLobbyHref(getLobbyExitUrlFallback());
}

/**
 * セッション解除後にロビーへ遷移
 */
export async function navigateToLobbyAfterLogout() {
    window.location.href = await resolveLobbyExitUrl();
}