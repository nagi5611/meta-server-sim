// ゲスト入場時は /admin/enter-metaverse を叩かない（401 と init 遅延を避ける）
const ADMIN_ENTRY_PATH = '/admin/enter-metaverse';

function hasAdminTokenCookie() {
    try {
        return document.cookie.split(';').some((c) => c.trim().startsWith('metaverseAdminToken='));
    } catch {
        return false;
    }
}

/**
 * @returns {Promise<{ token?: string, username?: string, mode?: string } | null>}
 */
export async function fetchAdminMetaverseEntry() {
    try {
        const legacy = sessionStorage.getItem('metaverseAdminToken');
        if (legacy && legacy.trim()) {
            return { token: legacy.trim() };
        }
    } catch {
        /* ignore */
    }

    if (!hasAdminTokenCookie()) {
        return null;
    }

    try {
        const res = await fetch(ADMIN_ENTRY_PATH, { credentials: 'include' });
        if (!res.ok) return null;
        const data = await res.json().catch(() => null);
        if (!data?.token) return null;
        try {
            sessionStorage.setItem('metaverseAdminToken', data.token);
        } catch {
            /* ignore */
        }
        return data;
    } catch {
        return null;
    }
}
