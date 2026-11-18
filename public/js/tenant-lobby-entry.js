// public/js/tenant-lobby-entry.js — ロビー画面から渡された表示名を先に適用
const DISPLAY_NAME_PARAM = 'displayName';
const LEGACY_PARAM = 'lobbyDisplayName';

/**
 * URL クエリの表示名を localStorage.username に書き込み（メタバース入室名）
 */
export function applyLobbyDisplayNameFromUrl() {
    if (typeof window === 'undefined' || !window.location) return;
    try {
        const params = new URLSearchParams(window.location.search);
        const raw = params.get(DISPLAY_NAME_PARAM) || params.get(LEGACY_PARAM);
        if (!raw) return;
        const name = String(raw).trim().slice(0, 16);
        if (!/^[\p{L}\p{N}_\- ]+$/u.test(name)) return;
        localStorage.setItem('username', name);
        params.delete(DISPLAY_NAME_PARAM);
        params.delete(LEGACY_PARAM);
        const qs = params.toString();
        const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash || ''}`;
        window.history.replaceState({}, '', next);
    } catch {
        /* ignore */
    }
}

if (typeof window !== 'undefined') {
    applyLobbyDisplayNameFromUrl();
}