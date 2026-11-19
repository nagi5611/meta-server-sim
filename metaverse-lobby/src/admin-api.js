import { fetchSim } from './sim-client.js';
import { entryToWorld, worldToEntry } from './catalog-map.js';
import { readCookie, setCookieHeader, signJwt, verifyJwt } from './jwt.js';
import { insertAuditLog } from './db-ops.js';

const ADMIN_COOKIE = 'lobby_admin_session';
const LIVE_KEY = 'live';

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
    });
}

/**
 * @param {Record<string, unknown>} env
 */
async function verifyAdmin(request, env) {
    const secret = String(env.LOBBY_ADMIN_SESSION_SECRET || env.LOBBY_JWT_SECRET || '').trim();
    if (!secret) return null;
    const token =
        readCookie(request, ADMIN_COOKIE) ||
        (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return null;
    return verifyJwt(token, secret);
}

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 */
export async function handleAdminLogin(request, env) {
    if (request.method !== 'POST') return null;
    const url = new URL(request.url);
    if (url.pathname !== '/api/admin/login') return null;
    const body = await request.json();
    const login = String(body.username || body.email || '').trim();
    const pass = String(body.password || '');
    const expectUser = String(env.LOBBY_ADMIN_USER || 'admin').trim();
    const expectPass = String(env.LOBBY_ADMIN_PASSWORD || '').trim();

    /** @type {string} */
    let sessionUser = login;
    let authenticated = false;

    if (expectPass && login === expectUser && pass === expectPass) {
        authenticated = true;
        sessionUser = expectUser;
    } else {
        const sim = await fetchSim(env, '/service/lobby/admin-login', {
            method: 'POST',
            body: { login, password: pass },
        });
        if (sim.ok && sim.data?.user) {
            authenticated = true;
            sessionUser = String(sim.data.user.username || login);
        }
    }

    if (!authenticated) {
        return json({ error: 'invalid_credentials' }, 401);
    }
    const secret = String(env.LOBBY_ADMIN_SESSION_SECRET || env.LOBBY_JWT_SECRET || '').trim();
    if (!secret) return json({ error: 'session_not_configured' }, 503);
    const token = await signJwt({ sub: sessionUser, role: 'admin', admin: true }, secret, 60 * 60 * 12);
    const cookie = setCookieHeader(ADMIN_COOKIE, token, 60 * 60 * 12, '/');
    return json({ ok: true, user: { username: sessionUser, role: 'admin' } }, 200, { 'set-cookie': cookie });
}

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @param {KVNamespace} kv
 */
export async function handleAdminApi(request, env, kv) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/admin/')) return null;

    if (url.pathname === '/api/admin/logout' && request.method === 'POST') {
        return json({ ok: true }, 200, {
            'set-cookie': setCookieHeader(ADMIN_COOKIE, '', 0, '/'),
        });
    }

    const session = await verifyAdmin(request, env);
    if (!session && url.pathname !== '/api/admin/login') {
        return json({ error: 'unauthorized' }, 401);
    }

    if (url.pathname === '/api/admin/catalog' && request.method === 'GET') {
        const sim = await fetchSim(env, '/service/lobby-catalog');
        if (!sim.ok) return json(sim.data || { error: 'catalog_failed' }, sim.status);
        const live = (await kv.get(LIVE_KEY, 'json')) || { worlds: {} };
        const worlds = (sim.data?.metaverses || []).map((e) =>
            entryToWorld(e, live.worlds?.[e.id] || {}),
        );
        return json({ worlds, updatedAt: sim.data?.updatedAt || null });
    }

    if (url.pathname === '/api/admin/catalog' && request.method === 'PUT') {
        const body = await request.json();
        const prevSim = await fetchSim(env, '/service/lobby-catalog');
        const prevMap = new Map((prevSim.data?.metaverses || []).map((e) => [e.id, e]));
        const metaverses = (body.worlds || body.metaverses || []).map((w) =>
            worldToEntry(w, prevMap.get(w.id) || {}),
        );
        const sim = await fetchSim(env, '/service/lobby-catalog', { method: 'PUT', body: { metaverses } });
        if (!sim.ok) return json(sim.data || { error: 'save_failed' }, sim.status);
        if (sim.data?.workerPreview) {
            await kv.put('registry', JSON.stringify(sim.data.workerPreview));
        }
        return json({ ok: true, catalog: sim.data?.catalog, workerSync: sim.data?.workerSync });
    }

    if (url.pathname === '/api/admin/overview' && request.method === 'GET') {
        const live = (await kv.get(LIVE_KEY, 'json')) || { worlds: {}, series: {} };
        const worlds = Object.values(live.worlds || {});
        const online = worlds.reduce((a, w) => a + (Number(w.players) || 0), 0);
        const liveCount = worlds.filter((w) => w.status !== 'maint' && w.status !== 'degraded').length;
        let peak24 = 0;
        for (const series of Object.values(live.series || {})) {
            if (!Array.isArray(series)) continue;
            peak24 = Math.max(peak24, ...series.map((n) => Number(n) || 0));
        }
        return json({ online, liveWorlds: liveCount, totalWorlds: worlds.length, peak24h: peak24 });
    }

    if (url.pathname === '/api/admin/metrics' && request.method === 'GET') {
        const range = url.searchParams.get('range') || '24h';
        const worldId = url.searchParams.get('worldId') || '';
        const live = (await kv.get(LIVE_KEY, 'json')) || { worlds: {}, series: {} };
        const db = /** @type {D1Database | undefined} */ (env.LOBBY_DB);

        if (range === '7d' && db) {
            const rows = await db
                .prepare(
                    `SELECT bucket_at, peak, avg FROM metrics_presence_1d
                     WHERE world_id = ? ORDER BY bucket_at DESC LIMIT 7`,
                )
                .bind(worldId || '%')
                .all();
            const buckets = (rows.results || []).reverse();
            return json({
                range: '7d',
                labels: buckets.map((r) => String(r.bucket_at)),
                values: buckets.map((r) => Math.round(Number(r.avg) || 0)),
                perWorld: {},
            });
        }

        if (worldId) {
            const series = live.series?.[worldId] || new Array(24).fill(0);
            return json({ range: '24h', series, worldId });
        }

        const per = {};
        for (const [id, series] of Object.entries(live.series || {})) {
            per[id] = Array.isArray(series) ? series : new Array(24).fill(0);
        }
        return json({ range: '24h', per, series: live.series || {} });
    }

    if (url.pathname === '/api/admin/users' && request.method === 'GET') {
        const [students, teachers, presence] = await Promise.all([
            fetchSim(env, '/service/users/students'),
            fetchSim(env, '/service/users/teachers'),
            fetchSim(env, '/service/lobby/presence-index'),
        ]);
        const onlineRefs = new Set(
            (presence.data?.entries || [])
                .filter((e) => e.userRef)
                .map((e) => String(e.userRef)),
        );
        const onlineNames = new Set(
            (presence.data?.entries || []).map((e) => String(e.displayName || '')),
        );
        const rows = [];
        for (const u of [...(students.data || []), ...(teachers.data || [])]) {
            const userRef = `${u.kind}-${u.id}`;
            const role = u.lobbyRole === 'admin' || u.kind === 'teacher' ? 'admin' : 'member';
            rows.push({
                id: userRef,
                name: u.displayName || u.username,
                handle: `@${u.username}`,
                email: u.email || `${u.username}@mmh.local`,
                role: role === 'admin' ? 'admin' : 'member',
                joined: u.createdAt || '',
                last: '',
                online: onlineRefs.has(userRef) || onlineNames.has(u.displayName),
                banned: Boolean(u.banned),
                kind: u.kind,
                rawId: u.id,
                history: [],
            });
        }
        return json({ users: rows });
    }

    if (url.pathname.startsWith('/api/admin/users/') && request.method === 'PATCH') {
        const id = decodeURIComponent(url.pathname.replace('/api/admin/users/', ''));
        const [kind, rawId] = id.split('-');
        const body = await request.json();
        const patch = {};
        if (body.banned !== undefined) patch.banned = Boolean(body.banned);
        if (body.email !== undefined) patch.email = String(body.email).trim();
        if (body.role === 'admin' || body.lobbyRole === 'admin') patch.lobbyRole = 'admin';
        if (body.role === 'member' || body.lobbyRole === 'user') patch.lobbyRole = 'user';
        const sim = await fetchSim(env, `/service/users/${kind}/${rawId}`, { method: 'PATCH', body: patch });
        if (!sim.ok) return json(sim.data || { error: 'patch_failed' }, sim.status);
        const db = env.LOBBY_DB;
        if (db) {
            await insertAuditLog(db, {
                id: crypto.randomUUID(),
                actor: session?.sub || 'admin',
                action: 'user_patch',
                target_type: 'user',
                target_id: id,
                detail: patch,
                created_at: new Date().toISOString(),
            });
        }
        return json({ ok: true, user: sim.data });
    }

    const resetMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/password-reset$/);
    if (resetMatch && request.method === 'POST') {
        const userId = decodeURIComponent(resetMatch[1]);
        const [kind, rawId] = userId.split('-');
        const sim = await fetchSim(env, `/service/users/${kind}/${rawId}/password-reset`, { method: 'POST', body: {} });
        return json(sim.data || { ok: sim.ok }, sim.status || (sim.ok ? 200 : 502));
    }

    const kickMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/kick$/);
    if (kickMatch && request.method === 'POST') {
        const userId = decodeURIComponent(kickMatch[1]);
        const sim = await fetchSim(env, '/service/lobby/kick', { method: 'POST', body: { userRef: userId } });
        return json(sim.data || { ok: sim.ok }, sim.status || (sim.ok ? 200 : 502));
    }

    if (url.pathname === '/api/admin/join-logs' && request.method === 'GET') {
        const db = env.LOBBY_DB;
        if (!db) return json({ logs: [] });
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
        const limit = 50;
        const offset = (page - 1) * limit;
        const rows = await db
            .prepare(`SELECT * FROM join_events ORDER BY joined_at DESC LIMIT ? OFFSET ?`)
            .bind(limit, offset)
            .all();
        return json({ logs: rows.results || [], page });
    }

    return json({ error: 'not_found' }, 404);
}