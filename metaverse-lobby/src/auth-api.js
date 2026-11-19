import { fetchSim } from './sim-client.js';
import { readCookie, setCookieHeader, signJwt, verifyJwt } from './jwt.js';
import { insertJoinEvent } from './db-ops.js';
import { handleProfileAvatarUpload } from './lobby-profile-assets.js';
import { resolveLobbySessionBan } from './lobby-ban-guard.js';

const PUBLIC_COOKIE = 'lobby_session';

/**
 * @param {Record<string, unknown>} env
 */
export async function resolveLobbyViewer(request, env) {
    const secret = String(env.LOBBY_JWT_SECRET || '').trim();
    if (!secret) return 'guest';
    const token =
        readCookie(request, PUBLIC_COOKIE) ||
        (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token) return 'guest';
    const payload = await verifyJwt(token, secret);
    if (!payload?.sub) return 'guest';
    if (payload.banned) return 'guest';
    const role = String(payload.role || 'member');
    if (role === 'admin') return 'admin';
    return 'signed';
}

/**
 * @param {Record<string, unknown>} env
 */
export async function getPublicSession(request, env) {
    const secret = String(env.LOBBY_JWT_SECRET || '').trim();
    if (!secret) return null;
    const token = readCookie(request, PUBLIC_COOKIE);
    if (!token) return null;
    return verifyJwt(token, secret);
}

/**
 * @param {Record<string, unknown> | null | undefined} session
 */
export function isLobbySessionBanned(session) {
    return Boolean(session?.sub && session.banned);
}

function json(data, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders },
    });
}

/**
 * @param {{ username: string, displayName: string, role?: string, avatarUrl?: string }} simUser
 * @param {string} [roleOverride]
 */
function toPublicUser(simUser, roleOverride) {
    const avatarUrl = String(simUser.avatarUrl || '').trim();
    const out = {
        name: simUser.displayName,
        handle: `@${simUser.username}`,
        role: roleOverride || simUser.role || 'member',
    };
    if (avatarUrl) out.avatarUrl = avatarUrl;
    return out;
}

/**
 * @param {Record<string, unknown>} session
 * @param {{ username: string, displayName: string, avatarUrl?: string }} simUser
 * @param {string} secret
 */
async function issueSessionResponse(session, simUser, secret) {
    const avatarUrl = String(simUser.avatarUrl || session.avatarUrl || '').trim();
    const token = await signJwt(
        {
            sub: session.sub,
            username: simUser.username,
            displayName: simUser.displayName,
            role: session.role,
            banned: session.banned,
            ...(avatarUrl ? { avatarUrl } : {}),
        },
        secret,
        60 * 60 * 24 * 7,
    );
    const cookie = setCookieHeader(PUBLIC_COOKIE, token, 60 * 60 * 24 * 7, '/');
    return { cookie, user: toPublicUser({ ...simUser, avatarUrl }, session.role) };
}

/**
 * @param {Request} request
 * @param {Record<string, unknown>} env
 */
export async function handlePublicAuth(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
        const body = await request.json();
        const sim = await fetchSim(env, '/api/lobby/auth/login', { method: 'POST', body });
        if (!sim.ok) return json(sim.data || { error: 'login_failed' }, sim.status || 401);
        const user = sim.data?.user;
        if (!user) return json({ error: 'login_failed' }, 401);
        const secret = String(env.LOBBY_JWT_SECRET || '').trim();
        if (!secret) return json({ error: 'jwt_not_configured' }, 503);
        const avatarUrl = String(user.avatarUrl || '').trim();
        const token = await signJwt(
            {
                sub: user.userId,
                username: user.username,
                displayName: user.displayName,
                role: user.role,
                banned: user.banned,
                ...(avatarUrl ? { avatarUrl } : {}),
            },
            secret,
            60 * 60 * 24 * 7,
        );
        const cookie = setCookieHeader(PUBLIC_COOKIE, token, 60 * 60 * 24 * 7, '/');
        return json({ ok: true, user: toPublicUser(user, user.role) }, 200, {
            'set-cookie': cookie,
        });
    }

    if (url.pathname === '/api/auth/signup' && request.method === 'POST') {
        const body = await request.json();
        const sim = await fetchSim(env, '/api/lobby/auth/signup', { method: 'POST', body });
        if (!sim.ok) return json(sim.data || { error: 'signup_failed' }, sim.status || 400);
        const user = sim.data?.user;
        if (!user) return json({ error: 'signup_failed' }, 500);
        const secret = String(env.LOBBY_JWT_SECRET || '').trim();
        if (!secret) return json({ error: 'jwt_not_configured' }, 503);
        const token = await signJwt(
            {
                sub: user.userId,
                username: user.username,
                displayName: user.displayName,
                role: user.role,
                banned: user.banned,
            },
            secret,
            60 * 60 * 24 * 7,
        );
        const cookie = setCookieHeader(PUBLIC_COOKIE, token, 60 * 60 * 24 * 7, '/');
        return json({ ok: true, user: toPublicUser(user, user.role) }, 201, {
            'set-cookie': cookie,
        });
    }

    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
        const session = await getPublicSession(request, env);
        if (!session) return json({ user: null });
        let role = String(session.role || 'member');
        const refMatch = /^((?:student|teacher))-(\d+)$/.exec(String(session.sub || ''));
        if (refMatch) {
            const sim = await fetchSim(env, `/service/users/${refMatch[1]}/${refMatch[2]}`);
            if (sim.ok && sim.data) {
                if (sim.data.banned) {
                    return json({ user: null, banned: true, message: 'banned' });
                }
                if (session.banned) {
                    return json({ user: null, banned: false, reauth: true });
                }
                const lobbyRole = String(sim.data.lobbyRole || 'user');
                role = lobbyRole === 'admin' ? 'admin' : 'member';
            } else if (isLobbySessionBanned(session)) {
                return json({ user: null, banned: true, message: 'banned' });
            }
        } else if (isLobbySessionBanned(session)) {
            return json({ user: null, banned: true, message: 'banned' });
        }
        const avatarUrl = String(session.avatarUrl || '').trim();
        const user = {
            name: session.displayName || session.username,
            handle: `@${session.username}`,
            role,
        };
        if (avatarUrl) user.avatarUrl = avatarUrl;
        return json({ user });
    }

    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
        return json({ ok: true }, 200, {
            'set-cookie': setCookieHeader(PUBLIC_COOKIE, '', 0, '/'),
        });
    }

    if (url.pathname === '/api/auth/profile/avatar' && request.method === 'POST') {
        const session = await getPublicSession(request, env);
        if (!session?.sub) return json({ error: 'unauthorized' }, 401);
        const uploadRes = await handleProfileAvatarUpload(request, env, String(session.sub));
        if (!uploadRes || uploadRes.status >= 400) return uploadRes;
        const uploadJson = await uploadRes.json();
        const avatarUrl = String(uploadJson.avatarUrl || '').trim();
        if (!avatarUrl) return json({ error: 'avatar_upload_failed' }, 500);
        const sim = await fetchSim(env, '/service/lobby/user-profile', {
            method: 'PATCH',
            body: { userRef: session.sub, avatarUrl },
        });
        if (!sim.ok) return json(sim.data || { error: 'profile_update_failed' }, sim.status || 400);
        const user = sim.data?.user;
        if (!user) return json({ error: 'profile_update_failed' }, 500);
        const secret = String(env.LOBBY_JWT_SECRET || '').trim();
        if (!secret) return json({ error: 'jwt_not_configured' }, 503);
        const issued = await issueSessionResponse(session, user, secret);
        return json({ ok: true, avatarUrl, user: issued.user }, 200, { 'set-cookie': issued.cookie });
    }

    if (url.pathname === '/api/auth/profile' && request.method === 'PATCH') {
        const session = await getPublicSession(request, env);
        if (!session?.sub) return json({ error: 'unauthorized' }, 401);
        const body = await request.json();
        const displayName = String(body?.displayName || body?.name || '').trim();
        if (!displayName) return json({ error: 'name_required' }, 400);
        if (displayName.length > 64) return json({ error: 'name_too_long', maxLength: 64 }, 400);
        if (!/^[\p{L}\p{N}_\- ]+$/u.test(displayName)) {
            return json({ error: 'invalid_name_chars' }, 400);
        }
        const sim = await fetchSim(env, '/service/lobby/user-profile', {
            method: 'PATCH',
            body: { userRef: session.sub, displayName },
        });
        if (!sim.ok) return json(sim.data || { error: 'profile_update_failed' }, sim.status || 400);
        const user = sim.data?.user;
        if (!user) return json({ error: 'profile_update_failed' }, 500);
        const secret = String(env.LOBBY_JWT_SECRET || '').trim();
        if (!secret) return json({ error: 'jwt_not_configured' }, 503);
        const issued = await issueSessionResponse(session, user, secret);
        return json({ ok: true, user: issued.user }, 200, { 'set-cookie': issued.cookie });
    }

    if (url.pathname === '/api/auth/reset-password' && request.method === 'POST') {
        const body = await request.json();
        const sim = await fetchSim(env, '/api/lobby/auth/reset-password', { method: 'POST', body });
        return json(sim.data || { error: 'reset_failed' }, sim.status || (sim.ok ? 200 : 400));
    }

    if (url.pathname === '/api/favorites' && request.method === 'GET') {
        const session = await getPublicSession(request, env);
        if (!session?.sub) return json({ error: 'unauthorized' }, 401);
        const sim = await fetchSim(env, `/service/lobby/favorites?userRef=${encodeURIComponent(session.sub)}`);
        if (!sim.ok) return json(sim.data || { error: 'favorites_list_failed' }, sim.status || 502);
        return json({
            ok: true,
            worldIds: Array.isArray(sim.data?.worldIds) ? sim.data.worldIds : [],
        });
    }

    if (url.pathname === '/api/favorites' && request.method === 'PATCH') {
        const session = await getPublicSession(request, env);
        if (!session?.sub) return json({ error: 'unauthorized' }, 401);
        const body = await request.json();
        const sim = await fetchSim(env, '/service/lobby/favorites', {
            method: 'PATCH',
            body: { ...body, userRef: session.sub },
        });
        if (!sim.ok) return json(sim.data || { error: 'favorites_update_failed' }, sim.status || 502);
        return json({
            ok: true,
            worldId: sim.data?.worldId,
            favorite: sim.data?.favorite,
            worldIds: Array.isArray(sim.data?.worldIds) ? sim.data.worldIds : [],
        });
    }

    if (url.pathname === '/api/favorites/toggle' && request.method === 'POST') {
        const session = await getPublicSession(request, env);
        if (!session?.sub) return json({ error: 'unauthorized' }, 401);
        const body = await request.json();
        const sim = await fetchSim(env, '/service/lobby/favorites/toggle', {
            method: 'POST',
            body: { ...body, userRef: session.sub },
        });
        if (!sim.ok) return json(sim.data || { error: 'favorites_toggle_failed' }, sim.status || 502);
        return json({
            ok: true,
            worldId: sim.data?.worldId,
            favorite: sim.data?.favorite,
            toggled: sim.data?.toggled,
            worldIds: Array.isArray(sim.data?.worldIds) ? sim.data.worldIds : [],
        });
    }

    if (url.pathname === '/api/join-events' && request.method === 'POST') {
        const db = /** @type {D1Database | undefined} */ (env.LOBBY_DB);
        const body = await request.json();
        const session = await getPublicSession(request, env);
        const ban = await resolveLobbySessionBan(session, env);
        if (ban.banned) {
            return json({ error: 'banned' }, 403);
        }
        const id = `je-${crypto.randomUUID()}`;
        const row = {
            id,
            user_ref: session?.sub || null,
            display_name: String(body.displayName || session?.displayName || 'Guest'),
            world_id: String(body.worldId || ''),
            tenant_id: body.tenantId || null,
            joined_at: new Date().toISOString(),
            left_at: null,
            ok: body.ok !== false,
            meta: body.meta || null,
        };
        if (db) await insertJoinEvent(db, row);
        return json({ ok: true, id });
    }

    return null;
}