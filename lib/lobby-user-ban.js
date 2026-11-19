import { getLobbyUserByKindId } from '../db/users.js';

export function parseLobbyUserRef(ref) {
    const m = /^((?:student|teacher))-(\d+)$/.exec(String(ref || '').trim());
    if (!m) return null;
    const id = Number(m[2]);
    if (!Number.isFinite(id)) return null;
    return { kind: /** @type {'student' | 'teacher'} */ (m[1]), id };
}

export async function isLobbyUserRefBanned(userRef) {
    const parsed = parseLobbyUserRef(userRef);
    if (!parsed) return false;
    try {
        const user = await getLobbyUserByKindId(parsed.kind, parsed.id);
        return Boolean(user?.banned);
    } catch (err) {
        console.error('[lobby-user-ban] lookup failed:', err);
        return false;
    }
}
