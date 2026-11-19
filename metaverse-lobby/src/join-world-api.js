import { getPublicSession, resolveLobbyViewer } from './auth-api.js';
import { resolveLobbySessionBan } from './lobby-ban-guard.js';
import { findRegistryEntryByJoinCode, normalizeJoinCode } from './join-by-code-api.js';
import { insertJoinEvent } from './db-ops.js';

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

function findRegistryEntryByWorldId(metaverses, worldId) {
    const id = String(worldId || '').trim();
    if (!id) return null;
    return metaverses.find((m) => String(m.id || '') === id) || null;
}

export async function handleJoinWorldRequest(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== '/api/join-world' || request.method !== 'POST') return null;

    const kv = env.LOBBY_KV;
    const session = await getPublicSession(request, env);
    const ban = await resolveLobbySessionBan(session, env);
    if (ban.banned) return json({ error: 'banned', message: 'banned' }, 403);

    let body;
    try {
        body = await request.json();
    } catch {
        return json({ error: 'invalid_json' }, 400);
    }

    const worldId = String(body?.worldId || '').trim();
    const joinCode = normalizeJoinCode(body?.joinCode);
    const displayName = String(body?.displayName || session?.displayName || '').trim();

    if (!worldId && joinCode.length < 6) return json({ error: 'world_id_or_code_required' }, 400);
    if (displayName.length > 64) return json({ error: 'name_too_long', maxLength: 64 }, 400);
    if (displayName && !/^[\p{L}\p{N}_\- ]+$/u.test(displayName)) return json({ error: 'invalid_name_chars' }, 400);

    const registry = (await kv.get('registry', 'json')) || { metaverses: [] };
    const live = (await kv.get(LIVE_KEY, 'json')) || { worlds: {}, series: {} };
    const list = registry.metaverses || [];
    const hit = worldId ? findRegistryEntryByWorldId(list, worldId) : findRegistryEntryByJoinCode(list, joinCode);
    if (!hit) return json({ error: 'not_found' }, 404);

    const viewer = await resolveLobbyViewer(request, env);
    if (!audienceVisible(hit.audience, viewer)) return json({ error: 'not_found' }, 404);

    const world = mapPublicWorld(hit, live);
    if (world.status === 'maint') return json({ error: 'maintenance', world }, 503);

    const db = env.LOBBY_DB;
    if (db) {
        await insertJoinEvent(db, {
            id: `je-${crypto.randomUUID()}`,
            user_ref: session?.sub || null,
            display_name: displayName || 'Guest',
            world_id: String(world.id),
            tenant_id: hit.tenantId || null,
            joined_at: new Date().toISOString(),
            left_at: null,
            ok: true,
            meta: { via: 'join-world' },
        });
    }

    return json({ ok: true, world, entryUrl: world.entryUrl, userRef: session?.sub || null });
}
