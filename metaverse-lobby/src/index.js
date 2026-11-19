import { LobbyPoller } from './lobby-poller.js';
import { handlePublicAuth, resolveLobbyViewer } from './auth-api.js';
import { handleAdminApi, handleAdminLogin } from './admin-api.js';
import { handleAssetGet } from './lobby-assets.js';
import { handleProfileAvatarGet } from './lobby-profile-assets.js';
import { pickAnnouncementText, resolveClientLocale } from './announcement-i18n.js';
import { listAnnouncements, rollupDailyMetrics } from './db-ops.js';

export { LobbyPoller };

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

/**
 * @param {Record<string, unknown>} env
 */
async function pollStatus(env) {
    const kv = /** @type {KVNamespace} */ (env.LOBBY_KV);
    const registry = await kv.get('registry', 'json');
    const list = Array.isArray(registry?.metaverses) ? registry.metaverses : [];
    const prevLive = (await kv.get(LIVE_KEY, 'json')) || { worlds: {}, series: {} };
    const worlds = { ...(prevLive.worlds || {}) };

    for (const world of list) {
        const id = String(world?.id || '');
        if (!id) continue;
        let status = 'online';
        let maintenance = Boolean(world.maintenance);
        if (world.lobbyStatus === 'event') status = 'live';
        if (world.lobbyStatus === 'maint' || maintenance) status = 'maint';
        if (world.statusUrl) {
            try {
                const res = await fetch(world.statusUrl, { signal: AbortSignal.timeout(12_000) });
                if (res.ok) {
                    const data = await res.json();
                    maintenance = Boolean(data.maintenance) || data.status === 'maint' || !data.ok;
                    if (maintenance) status = 'maint';
                    else if (data.status === 'live' || world.lobbyStatus === 'event') status = 'live';
                } else {
                    status = 'degraded';
                }
            } catch {
                status = maintenance ? 'maint' : 'degraded';
            }
        } else if (maintenance) {
            status = 'maint';
        }
        const prev = worlds[id] || {};
        worlds[id] = {
            ...prev,
            status,
            maintenance,
            statusAt: new Date().toISOString(),
            name: world.name,
            capacity: world.capacity ?? null,
        };
    }

    await kv.put(
        LIVE_KEY,
        JSON.stringify({
            ...prevLive,
            worlds,
            statusAt: new Date().toISOString(),
        }),
    );
}

function audienceVisible(audience, viewer) {
    const a = String(audience || 'all');
    if (a === 'all') return true;
    if (a === 'signed') return viewer === 'signed' || viewer === 'admin';
    return viewer === 'admin';
}

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 */
async function handleApi(request, env) {
    const url = new URL(request.url);
    const kv = /** @type {KVNamespace} */ (env.LOBBY_KV);

    const profileAssetRes = await handleProfileAvatarGet(request, env);
    if (profileAssetRes) return profileAssetRes;

    const assetRes = await handleAssetGet(request, env);
    if (assetRes) return assetRes;

    const loginRes = await handleAdminLogin(request, env);
    if (loginRes) return loginRes;

    const publicAuth = await handlePublicAuth(request, env);
    if (publicAuth) return publicAuth;

    const adminRes = await handleAdminApi(request, env, kv);
    if (adminRes) return adminRes;

    if (url.pathname === '/api/admin/sync' && request.method === 'POST') {
        const secret = String(env.LOBBY_WORKER_SYNC_SECRET || '').trim();
        const auth = request.headers.get('authorization') || '';
        if (!secret || auth !== `Bearer ${secret}`) {
            return json({ error: 'unauthorized' }, 401);
        }
        const body = await request.json();
        await kv.put('registry', JSON.stringify(body));
        const id = env.LOBBY_POLLER.idFromName('primary');
        const stub = env.LOBBY_POLLER.get(id);
        await stub.fetch('http://lobby-poller/wake');
        await pollStatus(env);
        return json({ ok: true, count: body.metaverses?.length ?? 0 });
    }

    if (url.pathname === '/api/announcements' && request.method === 'GET') {
        const db = /** @type {D1Database | undefined} */ (env.LOBBY_DB);
        const locale = resolveClientLocale(request, url);
        const rows = db ? await listAnnouncements(db, { publishedOnly: true, limit: 3 }) : [];
        const announcements = rows.map((a) => {
            const { title } = pickAnnouncementText(a.i18n, locale, {
                title: a.title,
                body: a.body,
            });
            return {
                id: a.id,
                title,
                createdAt: a.createdAt,
                updatedAt: a.updatedAt,
            };
        });
        return json({ announcements, locale });
    }

    if (url.pathname === '/api/metaverses' && request.method === 'GET') {
        const registry = (await kv.get('registry', 'json')) || { metaverses: [] };
        const live = (await kv.get(LIVE_KEY, 'json')) || { worlds: {}, series: {} };
        const viewer = await resolveLobbyViewer(request, env);
        const preview = url.searchParams.get('preview') === '1' && viewer === 'admin';
        const metaverses = (registry.metaverses || [])
            .filter((m) => preview || audienceVisible(m.audience, viewer))
            .map((m) => {
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
            });
        return json({
            updatedAt: live.updatedAt || registry.updatedAt || null,
            metaverses,
            viewer,
        });
    }

    return null;
}

export default {
    async fetch(request, env, ctx) {
        const api = await handleApi(request, env);
        if (api) return api;
        if (request.method === 'GET' && new URL(request.url).pathname === '/api/health') {
            return json({ ok: true, service: 'metaverse-lobby' });
        }
        return new Response('Not Found', { status: 404 });
    },
    async scheduled(event, env, ctx) {
        ctx.waitUntil(pollStatus(env));
        const id = env.LOBBY_POLLER.idFromName('primary');
        ctx.waitUntil(env.LOBBY_POLLER.get(id).fetch('http://lobby-poller/wake'));
        if (env.LOBBY_DB) {
            ctx.waitUntil(rollupDailyMetrics(env.LOBBY_DB));
        }
    },
};