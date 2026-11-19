/**
 * @param {string} userRef
 */
export function parseLobbyUserRef(userRef) {
    const m = /^((?:student|teacher))-(\d+)$/.exec(String(userRef || '').trim());
    if (!m) return null;
    const id = Number(m[2]);
    if (!Number.isFinite(id)) return null;
    return { kind: m[1], id, userRef: `${m[1]}-${id}` };
}

/**
 * @param {unknown} raw
 */
export function normalizeLobbyWorldSlug(raw) {
    const s = String(raw ?? '').trim();
    if (!s || s.length > 128) return null;
    if (!/^[\w.-]+$/i.test(s)) return null;
    return s;
}
