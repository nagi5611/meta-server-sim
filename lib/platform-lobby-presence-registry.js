// In-memory lobby presence index (per sim process) for admin kick / online flags

/** @type {Map<string, { userRef: string, displayName: string, tenantId: string, socketId: string, at: string }>} */
const bySocket = new Map();
/** @type {Map<string, Set<string>>} */
const byUserRef = new Map();

/**
 * @param {{ userRef?: string, displayName?: string, tenantId: string, socketId: string }} opts
 */
export function registerLobbyPresence(opts) {
    const tenantId = String(opts.tenantId || '').trim();
    const socketId = String(opts.socketId || '').trim();
    if (!tenantId || !socketId) return;
    const userRef = opts.userRef ? String(opts.userRef).trim() : '';
    const displayName = String(opts.displayName || '').trim();
    const row = {
        userRef,
        displayName,
        tenantId,
        socketId,
        at: new Date().toISOString(),
    };
    bySocket.set(socketId, row);
    if (userRef) {
        let set = byUserRef.get(userRef);
        if (!set) {
            set = new Set();
            byUserRef.set(userRef, set);
        }
        set.add(socketId);
    }
}

/**
 * @param {string} socketId
 */
export function unregisterLobbyPresence(socketId) {
    const row = bySocket.get(socketId);
    if (!row) return;
    bySocket.delete(socketId);
    if (row.userRef) {
        const set = byUserRef.get(row.userRef);
        if (set) {
            set.delete(socketId);
            if (!set.size) byUserRef.delete(row.userRef);
        }
    }
}

export function getLobbyPresenceIndex() {
    return Array.from(bySocket.values());
}

/**
 * @param {{ userRef?: string, displayName?: string }} opts
 */
export function kickLobbyUser(opts) {
    const userRef = String(opts.userRef || '').trim();
    const displayName = String(opts.displayName || '').trim();
    let sockets = [];
    if (userRef && byUserRef.has(userRef)) {
        sockets = [...byUserRef.get(userRef)];
    } else if (displayName) {
        sockets = [...bySocket.entries()]
            .filter(([, v]) => v.displayName === displayName)
            .map(([k]) => k);
    }
    if (!sockets.length) {
        return { ok: false, status: 404, error: 'not_online' };
    }
    return { ok: true, socketIds: sockets, message: 'kick_enqueued' };
}

/** @type {((payload: { tenantId: string, socketIds: string[] }) => void) | null} */
let kickDispatcher = null;

/**
 * @param {(payload: { tenantId: string, socketIds: string[] }) => void} fn
 */
export function setLobbyKickDispatcher(fn) {
    kickDispatcher = fn;
}

/**
 * @param {string} socketId
 */
export function executeKickForSocket(socketId) {
    const row = bySocket.get(socketId);
    if (!row || !kickDispatcher) return false;
    kickDispatcher({ tenantId: row.tenantId, socketIds: [socketId] });
    return true;
}