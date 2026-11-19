// ゲスト入場時は /admin/enter-metaverse を叩かない（無駄なトークン発行と init 遅延を避ける）
const ADMIN_ENTRY_PATH = '/admin/enter-metaverse';
const ADMIN_ENTRY_PROBE_PATH = '/admin/metaverse-entry-probe';

const LEGACY_ADMIN_TOKEN_STORAGE_KEY = 'metaverseAdminToken';

/** @type {{ token?: string, username?: string, mode?: string } | null} */
let inMemoryAdminMetaverseEntry = null;

if (typeof window !== 'undefined') {
    const pending = window.__TENANT_PENDING_ADMIN_METAVERSE_TOKEN__;
    if (typeof pending === 'string' && pending.trim()) {
        inMemoryAdminMetaverseEntry = { token: pending.trim() };
        try {
            delete window.__TENANT_PENDING_ADMIN_METAVERSE_TOKEN__;
        } catch {
            window.__TENANT_PENDING_ADMIN_METAVERSE_TOKEN__ = undefined;
        }
    }
}

/**
 * 旧 sessionStorage 由来のトークンを除去（XSS 耐性のため新規保存はしない）
 */
function clearLegacyAdminTokenStorage() {
    try {
        sessionStorage.removeItem(LEGACY_ADMIN_TOKEN_STORAGE_KEY);
    } catch {
        /* ignore */
    }
}

/**
 * HttpOnly Cookie の有無をサーバーが判定する（document.cookie では読めない）
 * @returns {Promise<boolean>}
 */
async function probeAdminMetaverseEntryCookie() {
    try {
        const res = await fetch(ADMIN_ENTRY_PROBE_PATH, { credentials: 'include' });
        if (!res.ok) return false;
        const data = await res.json().catch(() => null);
        return data?.active === true;
    } catch {
        return false;
    }
}

/**
 * Socket handshake 用にメモリ上の管理トークンを返す（ページリロードで消える）
 * @returns {string | null}
 */
export function getInMemoryAdminMetaverseToken() {
    const t = inMemoryAdminMetaverseEntry?.token;
    return typeof t === 'string' && t.trim() ? t.trim() : null;
}

/**
 * ログアウト等でメモリ上の管理入場情報を破棄する
 */
export function clearInMemoryAdminMetaverseEntry() {
    inMemoryAdminMetaverseEntry = null;
    clearLegacyAdminTokenStorage();
}

/**
 * E2E 等で HttpOnly Cookie 経路を模す（本番 UI からは呼ばない）
 * @param {string} token
 */
export function setInMemoryAdminMetaverseTokenForTests(token) {
    const trimmed = String(token ?? '').trim();
    if (!trimmed) {
        clearInMemoryAdminMetaverseEntry();
        return;
    }
    inMemoryAdminMetaverseEntry = { token: trimmed };
}

/**
 * @returns {Promise<{ token?: string, username?: string, mode?: string } | null>}
 */
export async function fetchAdminMetaverseEntry() {
    clearLegacyAdminTokenStorage();

    if (!inMemoryAdminMetaverseEntry && !(await probeAdminMetaverseEntryCookie())) {
        return null;
    }

    try {
        const res = await fetch(ADMIN_ENTRY_PATH, { credentials: 'include' });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        if (!data?.token) return null;
        inMemoryAdminMetaverseEntry = data;
        return data;
    } catch {
        return null;
    }
}