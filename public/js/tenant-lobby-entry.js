// public/js/tenant-lobby-entry.js — ロビー画面から渡された表示名を先に適用
const DISPLAY_NAME_PARAM = 'displayName';
const LEGACY_PARAM = 'lobbyDisplayName';
const LJDN_PARAM = 'ljdn';

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

/**
 * 共有参加 `ljdn` トークンから表示名を取得（URL に生名を載せない）
 */
async function applyLjdnDisplayNameFromUrl() {
    if (typeof window === 'undefined' || !window.location) return;
    const params = new URLSearchParams(window.location.search);
    const token = params.get(LJDN_PARAM);
    if (!token) return;
    const tenantSeg = window.location.pathname.split('/').filter(Boolean)[0];
    if (!tenantSeg) return;
    try {
        const res = await fetch(
            `/${encodeURIComponent(tenantSeg)}/api/lobby-display-join?ljdn=${encodeURIComponent(token)}`,
            { credentials: 'include', cache: 'no-store' },
        );
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.displayName) return;
        const name = String(data.displayName).trim().slice(0, 64);
        if (!name || !/^[\p{L}\p{N}_\- ]+$/u.test(name)) return;
        localStorage.setItem('username', name);
        localStorage.setItem('mnm.name', name);
        localStorage.setItem('lobbyDisplayName', name);
        params.delete(LJDN_PARAM);
        const qs = params.toString();
        const next = `${window.location.pathname}${qs ? `?${qs}` : ''}${window.location.hash || ''}`;
        window.history.replaceState({}, '', next);
    } catch {
        /* ignore */
    }
}

if (typeof window !== 'undefined') {
    await applyLjdnDisplayNameFromUrl();
    applyLobbyDisplayNameFromUrl();
}