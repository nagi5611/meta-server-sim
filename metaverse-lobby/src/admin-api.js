import { fetchSim } from './sim-client.js';
import { getPublicSession } from './auth-api.js';
import { entryToWorld, worldToEntry } from './catalog-map.js';
import { readCookie, setCookieHeader, signJwt, verifyJwt } from './jwt.js';
import {
    mergeAnnouncementI18nOverrides,
    normalizeAnnouncementLocale,
    parseAdminAnnouncementI18n,
    parseAnnouncementI18nJson,
} from './announcement-i18n.js';
import {
    DEFAULT_ANNOUNCEMENT_GEMINI_MODEL,
    translateAnnouncementFields,
} from './announcement-translator.js';
import {
    deleteAnnouncement,
    insertAnnouncement,
    insertAuditLog,
    listAnnouncements,
    updateAnnouncement,
} from './db-ops.js';
import { handleThumbnailUpload } from './lobby-assets.js';

const ADMIN_COOKIE = 'lobby_admin_session';
const LIVE_KEY = 'live';

/**
 * @param {Record<string, unknown>} env
 * @param {{ sourceLocale: string, title: string, body: string }} input
 */
async function buildAnnouncementI18n(env, input) {
    const apiKey = String(env.GEMINI_TRANSLATION_API_KEY || '').trim();
    const model = String(env.GEMINI_TRANSLATION_MODEL || DEFAULT_ANNOUNCEMENT_GEMINI_MODEL).trim();
    return translateAnnouncementFields({
        apiKey,
        model,
        sourceLocale: input.sourceLocale,
        title: input.title,
        body: input.body,
    });
}

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
    const login = String(body.login || body.username || body.email || '').trim();
    const pass = String(body.password || '');
    const expectUser = String(env.LOBBY_ADMIN_USER || 'admin').trim();
    const expectPass = String(env.LOBBY_ADMIN_PASSWORD || '').trim();

    /** @type {string} */
    let sessionUser = login;
    let authenticated = false;
    /** @type {{ ok: boolean, status: number, data: Record<string, unknown> | null }} | null */
    let simResult = null;

    if (expectPass && login === expectUser && pass === expectPass) {
        authenticated = true;
        sessionUser = expectUser;
    } else {
        simResult = await fetchSim(env, '/service/lobby/admin-login', {
            method: 'POST',
            body: { login, password: pass },
        });
        if (simResult.ok && simResult.data?.user) {
            authenticated = true;
            sessionUser = String(simResult.data.user.username || login);
        }
    }

    if (!authenticated) {
        const simError = String(simResult?.data?.error || '').trim();
        if (simError === 'banned') return json({ error: 'banned' }, 403);
        if (simError === 'admin_required') return json({ error: 'admin_required' }, 403);
        if (simError === 'login_and_password_required') {
            return json({ error: 'login_and_password_required' }, 400);
        }
        const status = simResult && !simResult.ok && simResult.status >= 400 ? simResult.status : 401;
        return json({ error: simError || 'invalid_credentials' }, status === 403 ? 403 : 401);
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

    if (url.pathname === '/api/admin/bootstrap-from-lobby' && request.method === 'POST') {
        const publicSession = await getPublicSession(request, env);
        if (!publicSession || String(publicSession.role || '') !== 'admin') {
            return json({ error: 'forbidden' }, 403);
        }
        const secret = String(env.LOBBY_ADMIN_SESSION_SECRET || env.LOBBY_JWT_SECRET || '').trim();
        if (!secret) return json({ error: 'session_not_configured' }, 503);
        const sessionUser = String(publicSession.username || publicSession.sub || 'admin');
        const token = await signJwt({ sub: sessionUser, role: 'admin', admin: true }, secret, 60 * 60 * 12);
        const cookie = setCookieHeader(ADMIN_COOKIE, token, 60 * 60 * 12, '/');
        return json({ ok: true, user: { username: sessionUser, role: 'admin' } }, 200, { 'set-cookie': cookie });
    }

    const session = await verifyAdmin(request, env);
    if (!session && url.pathname !== '/api/admin/login') {
        return json({ error: 'unauthorized' }, 401);
    }

    const thumbUpload = await handleThumbnailUpload(request, env);
    if (thumbUpload) return thumbUpload;

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
            const role = u.lobbyRole === 'admin' ? 'admin' : 'member';
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
                banExpiresAt: u.banExpiresAt || null,
                kind: u.kind,
                rawId: u.id,
                history: [],
            });
        }
        return json({ users: rows });
    }

    const banHistoryMatch = url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/ban-history$/);
    if (banHistoryMatch && request.method === 'GET') {
        const userId = decodeURIComponent(banHistoryMatch[1]);
        const [kind, rawId] = userId.split('-');
        const sim = await fetchSim(env, `/service/users/${kind}/${rawId}/ban-history`);
        if (!sim.ok) return json(sim.data || { error: 'ban_history_failed' }, sim.status || 502);
        return json(sim.data || { history: [] });
    }

    if (url.pathname.startsWith('/api/admin/users/') && request.method === 'PATCH') {
        const id = decodeURIComponent(url.pathname.replace('/api/admin/users/', ''));
        const [kind, rawId] = id.split('-');
        const body = await request.json();
        const patch = {};
        if (body.banned !== undefined) patch.banned = Boolean(body.banned);
        if (body.banExpiresAt !== undefined) patch.banExpiresAt = body.banExpiresAt;
        if (body.banPermanent === true) patch.banExpiresAt = null;
        patch.actor = String(session?.sub || 'admin');
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
                action: patch.banned !== undefined ? (patch.banned ? 'user_ban' : 'user_unban') : 'user_patch',
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

    const annList = url.pathname === '/api/admin/announcements';
    const annItem = url.pathname.match(/^\/api\/admin\/announcements\/([^/]+)$/);
    const db = /** @type {D1Database | undefined} */ (env.LOBBY_DB);

    if (annList && request.method === 'GET') {
        const items = db ? await listAnnouncements(db, { publishedOnly: false, limit: 100 }) : [];
        return json({ announcements: items });
    }

    if (annList && request.method === 'POST') {
        if (!db) return json({ error: 'db_not_configured' }, 503);
        const body = await request.json();
        const bodyText = body.body === undefined || body.body === null ? '' : String(body.body).trim();
        const sourceLocale = normalizeAnnouncementLocale(
            String(body.sourceLocale || body.source_language || 'ja'),
        );
        const adminI18n = parseAdminAnnouncementI18n(body.i18n);
        const titleFromBody = String(body.title || '').trim();
        const sourceTitle =
            (adminI18n && adminI18n[sourceLocale]?.title) || titleFromBody;
        if (!sourceTitle) return json({ error: 'title_required' }, 400);
        const { i18n: autoI18n } = await buildAnnouncementI18n(env, {
            sourceLocale,
            title: sourceTitle,
            body: bodyText,
        });
        const i18n = mergeAnnouncementI18nOverrides(autoI18n, adminI18n);
        const title = i18n[sourceLocale]?.title || sourceTitle;
        const id = crypto.randomUUID();
        const item = await insertAnnouncement(db, id, {
            title,
            body: bodyText,
            published: body.published !== false,
            sortOrder: body.sortOrder,
            sourceLocale,
            i18n,
        });
        await insertAuditLog(db, {
            id: crypto.randomUUID(),
            actor: session?.sub || 'admin',
            action: 'announcement_create',
            target_type: 'announcement',
            target_id: id,
            detail: { title },
            created_at: new Date().toISOString(),
        });
        return json({ ok: true, announcement: item }, 201);
    }

    if (annItem && request.method === 'PUT') {
        if (!db) return json({ error: 'db_not_configured' }, 503);
        const id = decodeURIComponent(annItem[1]);
        const body = await request.json();
        const title = body.title !== undefined ? String(body.title).trim() : undefined;
        const bodyText = body.body !== undefined ? String(body.body).trim() : undefined;
        if (title === '') return json({ error: 'title_required' }, 400);
        const sourceLocale =
            body.sourceLocale !== undefined || body.source_language !== undefined
                ? normalizeAnnouncementLocale(String(body.sourceLocale || body.source_language || 'ja'))
                : undefined;
        const adminI18n = parseAdminAnnouncementI18n(body.i18n);
        const retranslate = Boolean(body.retranslate);
        const prev = (await listAnnouncements(db, { publishedOnly: false, limit: 100 })).find(
            (a) => a.id === id,
        );
        if (!prev) return json({ error: 'not_found' }, 404);
        const resolvedLocale = sourceLocale ?? prev.sourceLocale ?? 'ja';
        const resolvedTitle =
            (adminI18n && adminI18n[resolvedLocale]?.title) ||
            (title !== undefined ? title : prev.title) ||
            '';
        const shouldAutoTranslate =
            retranslate || title !== undefined || bodyText !== undefined || sourceLocale !== undefined;
        /** @type {Record<string, { title: string, body: string }> | undefined} */
        let i18n;
        let resolvedTitleForRow = title !== undefined ? title : prev.title;
        if (shouldAutoTranslate) {
            const resolvedBody = bodyText !== undefined ? bodyText : prev.body || '';
            if (resolvedTitle) {
                const built = await buildAnnouncementI18n(env, {
                    sourceLocale: resolvedLocale,
                    title: resolvedTitle,
                    body: resolvedBody,
                });
                i18n = mergeAnnouncementI18nOverrides(built.i18n, adminI18n);
                resolvedTitleForRow = i18n[resolvedLocale]?.title || resolvedTitle;
            }
        } else if (adminI18n) {
            const prevI18n = prev.i18n || parseAnnouncementI18nJson(prev.i18n_json);
            i18n = mergeAnnouncementI18nOverrides(prevI18n, adminI18n);
            resolvedTitleForRow = i18n[resolvedLocale]?.title || resolvedTitleForRow;
        }
        const item = await updateAnnouncement(db, id, {
            title: resolvedTitleForRow,
            body: bodyText,
            published: body.published,
            sortOrder: body.sortOrder,
            sourceLocale,
            i18n,
        });
        if (!item) return json({ error: 'not_found' }, 404);
        await insertAuditLog(db, {
            id: crypto.randomUUID(),
            actor: session?.sub || 'admin',
            action: 'announcement_update',
            target_type: 'announcement',
            target_id: id,
            detail: { title: item.title },
            created_at: new Date().toISOString(),
        });
        return json({ ok: true, announcement: item });
    }

    if (annItem && request.method === 'DELETE') {
        if (!db) return json({ error: 'db_not_configured' }, 503);
        const id = decodeURIComponent(annItem[1]);
        const removed = await deleteAnnouncement(db, id);
        if (!removed) return json({ error: 'not_found' }, 404);
        await insertAuditLog(db, {
            id: crypto.randomUUID(),
            actor: session?.sub || 'admin',
            action: 'announcement_delete',
            target_type: 'announcement',
            target_id: id,
            detail: {},
            created_at: new Date().toISOString(),
        });
        return json({ ok: true });
    }

    return json({ error: 'not_found' }, 404);
}