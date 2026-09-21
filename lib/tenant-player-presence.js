// lib/tenant-player-presence.js — ルーム内プレイヤー一覧の整合・重複セッション除去

/** report-ping が途切れた接続をルームから外すまでの猶予（NetworkManager の 30s 切断に合わせる） */
export const PLAYER_STALE_PING_REMOVE_MS = 45000;

/**
 * クライアントが Socket auth で送る永続セッション ID を正規化する
 * @param {unknown} value
 * @returns {string | null}
 */
export function normalizeClientSessionId(value) {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (trimmed.length < 8 || trimmed.length > 64) return null;
    if (!/^[a-zA-Z0-9_-]+$/.test(trimmed)) return null;
    return trimmed;
}

/**
 * ping 報告が古すぎてゾンビ扱いにするか
 * @param {object | undefined} player
 * @param {number} now
 * @param {number} [maxAgeMs]
 * @returns {boolean}
 */
export function isPlayerPingStale(player, now, maxAgeMs = PLAYER_STALE_PING_REMOVE_MS) {
    if (!player || player.pingReportedAt == null || typeof player.pingReportedAt !== 'number') {
        return false;
    }
    return now - player.pingReportedAt > maxAgeMs;
}

/**
 * ルーム状態から除去すべき socket ID を列挙する（純粋関数）
 * @param {{ players: Map<string, object> }} roomState
 * @param {{ isSocketConnected: (socketId: string) => boolean, now: number, maxPingAgeMs?: number }} ctx
 * @returns {Array<{ socketId: string, reason: 'disconnected' | 'stale_ping' }>}
 */
export function collectPlayersToPrune(roomState, ctx) {
    const maxPingAgeMs = ctx.maxPingAgeMs ?? PLAYER_STALE_PING_REMOVE_MS;
    const toRemove = [];
    for (const [socketId, player] of roomState.players.entries()) {
        if (!ctx.isSocketConnected(socketId)) {
            toRemove.push({ socketId, reason: 'disconnected' });
            continue;
        }
        if (isPlayerPingStale(player, ctx.now, maxPingAgeMs)) {
            toRemove.push({ socketId, reason: 'stale_ping' });
        }
    }
    return toRemove;
}

/**
 * 同一 clientSessionId の他ソケット ID を列挙（keep を除く）
 * @param {Map<string, Map<string, { players: Map<string, object> }>>} tenantRoomStates
 * @param {string} tenantId
 * @param {string} keepSocketId
 * @param {string} clientSessionId
 * @returns {Array<{ roomId: string, socketId: string }>}
 */
export function findDuplicateClientSessionSockets(tenantRoomStates, tenantId, keepSocketId, clientSessionId) {
    const byTenant = tenantRoomStates.get(tenantId);
    if (!byTenant) return [];

    const hits = [];
    for (const [roomId, roomState] of byTenant.entries()) {
        for (const [socketId, player] of roomState.players.entries()) {
            if (socketId === keepSocketId) continue;
            if (player?.clientSessionId === clientSessionId) {
                hits.push({ roomId, socketId });
            }
        }
    }
    return hits;
}

/**
 * 同一表示名（Guest 以外）の他ソケット ID を列挙
 * @param {Map<string, Map<string, { players: Map<string, object> }>>} tenantRoomStates
 * @param {string} tenantId
 * @param {string} keepSocketId
 * @param {string} displayName
 * @returns {Array<{ roomId: string, socketId: string }>}
 */
export function findDuplicateUsernameSockets(tenantRoomStates, tenantId, keepSocketId, displayName) {
    const normalized = String(displayName ?? '').trim();
    if (!normalized || normalized === 'Guest') return [];

    const byTenant = tenantRoomStates.get(tenantId);
    if (!byTenant) return [];

    const hits = [];
    for (const [roomId, roomState] of byTenant.entries()) {
        for (const [socketId, player] of roomState.players.entries()) {
            if (socketId === keepSocketId) continue;
            const other = String(player?.username ?? 'Guest').trim() || 'Guest';
            if (other === normalized) {
                hits.push({ roomId, socketId });
            }
        }
    }
    return hits;
}
