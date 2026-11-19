import { getPublicSession, resolveLobbyViewer } from './auth-api.js';
import { resolveLobbySessionBan } from './lobby-ban-guard.js';
import { isLobbyEntryUrlAllowed } from './lobby-entry-url-policy.js';

const LIVE_KEY = 'live';

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'content-type': 'application/json; charset=utf-8',
            'cache-control': 'no-store',
        },
    });
}

function audienceVisible(audience, viewer) {
    const a = String(audience || 'all');
    if (a === 'all') return true;
    if (a === 'signed') return viewer === 'signed' || viewer === 'admin';
    return viewer === 'admin';
}

/**
 * @param {string} raw
 */
export function normalizeJoinCode(raw) {
    return String(raw || '')
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, '')
        .slice(0, 12);
}

/**
 * @param {unknown[]} metaverses
 * @param {string} code
 */
export function findRegistryEntryByJoinCode(metaverses, code) {
    const norm = normalizeJoinCode(code);
    if (norm.length < 6) return null;
    return (
        metaverses.find((m) => String(/** @type {Record<string, unknown>} */ (m).joinCode || '').toUpperCase() === norm) ||
        null
    );
}

/**
 * @param {Record<string, unknown>} m
 * @param {Record<string, unknown>} live
 */
function mapPublicWorld(m, live) {
    const id = m.id;
    const w = live.worlds?.[id] || {};
    const series = live.series?.[id] || [];
    let status = w.status || (m.maintenance ? 'maint' : 'online');
    if (m.lobbyStatus === 'event') status = 'live';
    if (m.maintenance || m.lobbyStatus === 'maint') status = 'maint';
    return {
        id,
        name: m.name,
        joinCode: m.joinCode || null,
        entryUrl: m.entryUrl,
        description: m.description || '',
        thumbnailUrl: m.thumbnailUrl || null,
        capacity: m.capacity ?? null,
        audience: m.audience || 'all',
        players: Number(w.players ?? 0) || 0,
        status,
        series: series.length ? series : new Array(24).fill(0),
        statusAt: w.statusAt || live.statusAt || null,
        presenceAt: w.presenceAt || null,
    };
}

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 */
export async function handleJoinByCodeRequest(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/join-by-code' || request.method !== 'POST') return null;

    const kv = /** @type {KVNamespace} */ (env.LOBBY_KV);
    const session = await getPublicSession(request, env);
    const ban = await resolveLobbySessionBan(session, env);
    if (ban.banned) {
        return json({ error: 'banned', message: 'banned' }, 403);
    }

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'invalid_json' }, 400);
    }

    const code = normalizeJoinCode(body?.code);
    if (code.length < 6) {
        return json({ error: 'code_too_short', minLength: 6 }, 400);
    }

    const registry = (await kv.get('registry', 'json')) || { metaverses: [] };
    const live = (await kv.get(LIVE_KEY, 'json')) || { worlds: {}, series: {} };
    const viewer = await resolveLobbyViewer(request, env);
    const hit = findRegistryEntryByJoinCode(registry.metaverses || [], code);
    if (!hit) {
        return json({ error: 'not_found', code }, 404);
    }
    if (!isLobbyEntryUrlAllowed(hit.entryUrl, env)) {
        return json({ error: 'entry_url_not_allowed' }, 403);
    }
    if (!audienceVisible(hit.audience, viewer)) {
        return json({ error: 'not_found', code }, 404);
    }

    return json({ ok: true, world: mapPublicWorld(hit, live) });
}