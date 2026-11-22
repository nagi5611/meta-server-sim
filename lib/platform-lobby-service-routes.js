// Service routes for lobby Worker (scoped Bearer via lib/lobby-service-auth.js)

import {
    buildLobbyWorkerRegistry,
    loadLobbyCatalog,
    saveLobbyCatalog,
} from './platform-lobby-catalog.js';
import { syncLobbyCatalogToWorker } from './platform-lobby-sync.js';
import { lobbyServiceBearerAuth, LOBBY_SERVICE_SCOPES } from './lobby-service-auth.js';

const authRead = lobbyServiceBearerAuth(LOBBY_SERVICE_SCOPES.READ);
const authUserWrite = lobbyServiceBearerAuth(LOBBY_SERVICE_SCOPES.USER_WRITE);
const authCatalogWrite = lobbyServiceBearerAuth(LOBBY_SERVICE_SCOPES.CATALOG_WRITE);
const authSession = lobbyServiceBearerAuth(LOBBY_SERVICE_SCOPES.AUTH);
const authKick = lobbyServiceBearerAuth(LOBBY_SERVICE_SCOPES.KICK);
import {
    executeKickForSocket,
    getLobbyPresenceIndex,
    kickLobbyUser,
} from './platform-lobby-presence-registry.js';
import {
    listStudents,
    listTeachers,
    getLobbyUserByKindId,
    listLobbyBanHistory,
    patchLobbyUserFlags,
    updateStudent,
    updateTeacher,
    verifyStudent,
    verifyTeacher,
    completeLobbyGoogleAuth,
    peekLobbyGoogleAuth,
} from '../db/users.js';
import { sendLobbyPasswordResetEmail } from './lobby-password-reset.js';
import { sendLobbyBanNotificationEmail } from './lobby-ban-notification.js';
import {
    listLobbyWorldFavorites,
    setLobbyWorldFavorite,
    toggleLobbyWorldFavorite,
} from '../db/users.js';
import { normalizeLobbyWorldSlug, parseLobbyUserRef } from './lobby-favorites-parse.js';
import { moderateDisplayNameForJoin } from './display-name-moderation-policy.js';
import { buildLobbyAuthUser } from './platform-lobby-auth-user.js';
import { getTenant } from './tenant-registry.js';
import { getEffectiveTenantSocketSecret, isTenantSocketJoinEnforced } from './tenant-socket-auth.js';
import { mintTenantSocketJoinToken } from './tenant-socket-join-token.js';
import { isLobbyEntryUrlAllowed, lobbyEntryUrlPolicyHintJa } from './lobby-entry-url-policy.js';
import { createShareJoinRateLimit } from './http-rate-limit.js';
import { resolveShareJoinTarget } from './tenant-share-join.js';
import { moderateDisplayNameForJoin } from './display-name-moderation-policy.js';
import { mintLobbyDisplayNameJoinToken } from './lobby-display-name-join-token.js';

const shareJoinJoinRateLimit = createShareJoinRateLimit();

function normalizeServiceEntry(raw) {
    const id = String(raw?.id ?? '').trim();
    const name = String(raw?.name ?? '').trim();
    const entryUrl = String(raw?.entryUrl ?? '').trim();
    if (!id || !name || !entryUrl) return null;
    const audience = ['all', 'signed', 'admin'].includes(String(raw.audience || 'all'))
        ? String(raw.audience)
        : 'all';
    let lobbyStatus = ['open', 'event', 'maint'].includes(String(raw.lobbyStatus || 'open'))
        ? String(raw.lobbyStatus)
        : 'open';
    const maintenance = Boolean(raw.maintenance) || lobbyStatus === 'maint';
    if (maintenance) lobbyStatus = 'maint';
    return {
        id,
        name,
        entryUrl,
        joinCode: raw.joinCode != null ? String(raw.joinCode).trim().toUpperCase() : undefined,
        statusUrl: raw.statusUrl != null ? String(raw.statusUrl).trim() : undefined,
        presenceUrl: raw.presenceUrl != null ? String(raw.presenceUrl).trim() : undefined,
        description: raw.description != null ? String(raw.description) : undefined,
        thumbnailUrl: raw.thumbnailUrl != null ? String(raw.thumbnailUrl).trim() : undefined,
        maintenance,
        lobbyStatus,
        audience,
        capacity:
            raw.capacity != null && Number.isFinite(Number(raw.capacity))
                ? Number(raw.capacity)
                : undefined,
        sortOrder:
            raw.sortOrder != null && Number.isFinite(Number(raw.sortOrder))
                ? Number(raw.sortOrder)
                : 0,
        enabled: raw.enabled !== false,
        tenantId: raw.tenantId != null ? String(raw.tenantId).trim() : undefined,
    };
}

/**
 * @param {import('express').Express} app
 */
export function registerPlatformLobbyServiceRoutes(app) {
    app.get('/service/lobby-catalog', authRead, (_req, res) => {
        res.json(loadLobbyCatalog());
    });

    app.put('/service/lobby-catalog', authCatalogWrite, async (req, res) => {
        const body = req.body;
        if (!body || !Array.isArray(body.metaverses)) {
            return res.status(400).json({ error: 'invalid_payload', message: 'metaverses[] required' });
        }
        for (const raw of body.metaverses) {
            const entryUrl = String(raw?.entryUrl ?? '').trim();
            const entryId = String(raw?.id ?? '').trim();
            if (entryUrl && !isLobbyEntryUrlAllowed(entryUrl, process.env)) {
                return res.status(400).json({
                    error: 'entry_url_origin_not_allowed',
                    id: entryId || undefined,
                    entryUrl,
                    hint: lobbyEntryUrlPolicyHintJa(process.env),
                });
            }
        }
        const metaverses = body.metaverses.map(normalizeServiceEntry).filter(Boolean);
        const saved = saveLobbyCatalog({ metaverses });
        const sync = await syncLobbyCatalogToWorker(saved);
        res.json({
            ok: true,
            catalog: saved,
            workerSync: sync,
            workerPreview: buildLobbyWorkerRegistry(saved),
        });
    });

    app.post('/service/lobby-catalog/sync', authCatalogWrite, async (_req, res) => {
        const catalog = loadLobbyCatalog();
        const sync = await syncLobbyCatalogToWorker(catalog);
        if (!sync.ok) {
            return res.status(502).json({ error: 'worker_sync_failed', detail: sync });
        }
        res.json({ ok: true, workerSync: sync });
    });

    app.post('/service/lobby/socket-join-token', authRead, (req, res) => {
        const tenantId = String(req.body?.tenantId || '').trim();
        if (!tenantId) {
            return res.status(400).json({ error: 'tenant_id_required' });
        }
        const tenant = getTenant(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'tenant_not_found' });
        }
        if (!getEffectiveTenantSocketSecret(tenant)) {
            return res.json({ ok: true, joinToken: null, enforced: false });
        }
        const minted = mintTenantSocketJoinToken(tenant);
        if (!minted) {
            return res.status(500).json({ error: 'mint_failed' });
        }
        res.json({
            ok: true,
            joinToken: minted.joinToken,
            expiresAt: minted.expiresAt,
            enforced: isTenantSocketJoinEnforced(tenant),
        });
    });

    app.get('/service/users/students', authRead, async (_req, res) => {
        try {
            res.json(await listStudents());
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/service/users/teachers', authRead, async (_req, res) => {
        try {
            res.json(await listTeachers());
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/service/users/:kind/:id', authRead, async (req, res) => {
        const kind = String(req.params.kind || '');
        if (kind !== 'student' && kind !== 'teacher') {
            return res.status(400).json({ error: 'invalid_kind' });
        }
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
        try {
            const user = await getLobbyUserByKindId(kind, id);
            if (!user) return res.status(404).json({ error: 'not_found' });
            res.json(user);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/service/users/:kind/:id/ban-history', authRead, async (req, res) => {
        const kind = String(req.params.kind || '');
        if (kind !== 'student' && kind !== 'teacher') {
            return res.status(400).json({ error: 'invalid_kind' });
        }
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
        try {
            res.json({ history: await listLobbyBanHistory(kind, id, limit) });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.patch('/service/users/:kind/:id', authUserWrite, async (req, res) => {
        const kind = String(req.params.kind || '');
        if (kind !== 'student' && kind !== 'teacher') {
            return res.status(400).json({ error: 'invalid_kind' });
        }
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
        try {
            const body = { ...(req.body || {}) };
            if (body.actor == null && req.headers['x-lobby-ban-actor']) {
                body.actor = String(req.headers['x-lobby-ban-actor']);
            }
            if (body.lobbyRole !== undefined) {
                const superHdr = String(req.headers['x-lobby-super-admin'] || '').trim();
                if (superHdr !== '1') {
                    return res.status(403).json({ error: 'super_admin_required' });
                }
            }
            const updated = await patchLobbyUserFlags(kind, id, body);
            if (!updated) return res.status(404).json({ error: 'not_found' });
            if (body.banned === true) {
                try {
                    await sendLobbyBanNotificationEmail(kind, id, {
                        banExpiresAt: updated.banExpiresAt,
                    });
                } catch (err) {
                    console.error('PATCH /service/users ban notification:', err);
                }
            }
            res.json(updated);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/service/lobby/presence-index', authRead, (_req, res) => {
        res.json({ entries: getLobbyPresenceIndex() });
    });

    app.post('/service/lobby/auth/google/peek', authSession, async (req, res) => {
        const googleSub = String(req.body?.googleSub || req.body?.sub || '').trim();
        const email = String(req.body?.email || '').trim();
        if (!googleSub || !email) {
            return res.status(400).json({ error: 'google_profile_required' });
        }
        try {
            const peek = await peekLobbyGoogleAuth(googleSub, email);
            res.json({ ok: true, ...peek });
        } catch (err) {
            console.error('POST /service/lobby/auth/google/peek:', err);
            res.status(500).json({ error: 'google_peek_failed' });
        }
    });

    app.post('/service/lobby/auth/google', authSession, async (req, res) => {
        const googleSub = String(req.body?.googleSub || req.body?.sub || '').trim();
        const email = String(req.body?.email || '').trim();
        const emailVerified =
            req.body?.emailVerified === true || req.body?.email_verified === true;
        let displayName = String(req.body?.displayName || req.body?.name || '').trim();
        if (!googleSub || !email) {
            return res.status(400).json({ error: 'google_profile_required' });
        }
        try {
            const existingPeek = await peekLobbyGoogleAuth(googleSub, email);
            if (existingPeek.action === 'create') {
                if (!displayName) {
                    return res.status(400).json({ error: 'name_required' });
                }
                const moderation = await moderateDisplayNameForJoin({ displayName });
                if (!moderation.allowed) {
                    return res.status(422).json({ error: 'display_name_rejected' });
                }
            } else if (!displayName) {
                displayName = email.split('@')[0]?.trim() || '';
            }
            const picture = String(req.body?.picture || req.body?.pictureUrl || '').trim();
            const { kind, user } = await completeLobbyGoogleAuth({
                googleSub,
                email,
                displayName,
                emailVerified,
                picture,
            });
            res.json({ ok: true, user: buildLobbyAuthUser(kind, user) });
        } catch (err) {
            if (err.code === 'EMAIL_NOT_VERIFIED') {
                return res.status(400).json({ error: 'email_not_verified' });
            }
            if (err.code === 'INVALID_EMAIL') {
                return res.status(400).json({ error: 'invalid_email' });
            }
            if (err.code === 'EMAIL_EXISTS') {
                return res.status(409).json({ error: 'email_exists' });
            }
            if (err.code === 'GOOGLE_SUB_MISMATCH') {
                return res.status(409).json({ error: 'google_sub_mismatch' });
            }
            if (err.code === 'BANNED') {
                return res.status(403).json({ error: 'banned' });
            }
            if (err.code === 'NAME_REQUIRED') {
                return res.status(400).json({ error: 'name_required' });
            }
            console.error('POST /service/lobby/auth/google:', err);
            res.status(500).json({ error: 'google_auth_failed' });
        }
    });

    app.post('/service/lobby/admin-login', authSession, async (req, res) => {
        const login = String(req.body?.login || req.body?.username || req.body?.email || '').trim();
        const password = String(req.body?.password || '');
        if (!login || !password) {
            return res.status(400).json({ error: 'login_and_password_required' });
        }
        try {
            let user = await verifyStudent(login, password);
            let kind = 'student';
            if (!user) {
                user = await verifyTeacher(login, password);
                kind = 'teacher';
            }
            if (!user) {
                return res.status(401).json({ error: 'invalid_credentials' });
            }
            if (user.banned) {
                return res.status(403).json({ error: 'banned' });
            }
            const lobbyRole = user.lobbyRole || 'user';
            if (lobbyRole !== 'admin') {
                return res.status(403).json({ error: 'admin_required' });
            }
            res.json({
                ok: true,
                user: {
                    userId: `${kind}-${user.id}`,
                    kind,
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    displayName: user.displayName,
                    lobbyRole: 'admin',
                },
            });
        } catch (err) {
            console.error('POST /service/lobby/admin-login:', err);
            res.status(500).json({ error: 'login_failed' });
        }
    });

    app.post('/service/users/:kind/:id/password-reset', authUserWrite, async (req, res) => {
        const kind = String(req.params.kind || '');
        if (kind !== 'student' && kind !== 'teacher') {
            return res.status(400).json({ error: 'invalid_kind' });
        }
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
        try {
            const result = await sendLobbyPasswordResetEmail(kind, id);
            res.json(result);
        } catch (err) {
            const code = err.code || 'reset_failed';
            const status =
                code === 'NOT_FOUND' ? 404 : code === 'EMAIL_REQUIRED' ? 400 : code === 'RESEND_NOT_CONFIGURED' ? 503 : 502;
            res.status(status).json({ error: code, message: err.message });
        }
    });

    app.patch('/service/lobby/user-profile', authUserWrite, async (req, res) => {
        const userRef = String(req.body?.userRef || req.body?.userId || '').trim();
        const displayName =
            req.body?.displayName !== undefined || req.body?.name !== undefined
                ? String(req.body?.displayName || req.body?.name || '').trim()
                : undefined;
        const avatarUrl =
            req.body?.avatarUrl !== undefined ? String(req.body.avatarUrl || '').trim() : undefined;
        const m = /^((?:student|teacher))-(\d+)$/.exec(userRef);
        if (!m) {
            return res.status(400).json({ error: 'invalid_user_ref' });
        }
        if (displayName === undefined && avatarUrl === undefined) {
            return res.status(400).json({ error: 'no_changes' });
        }
        if (displayName !== undefined) {
            if (!displayName) {
                return res.status(400).json({ error: 'name_required' });
            }
            if (displayName.length > 64) {
                return res.status(400).json({ error: 'name_too_long', maxLength: 64 });
            }
            if (!/^[\p{L}\p{N}_\- ]+$/u.test(displayName)) {
                return res.status(400).json({ error: 'invalid_name_chars' });
            }
            const moderation = await moderateDisplayNameForJoin({ displayName });
            if (!moderation.allowed) {
                return res.status(422).json({ error: 'display_name_rejected' });
            }
        }
        if (avatarUrl !== undefined && avatarUrl.length > 512) {
            return res.status(400).json({ error: 'avatar_url_too_long', maxLength: 512 });
        }
        const kind = m[1];
        const id = Number(m[2]);
        const patch = {};
        if (displayName !== undefined) patch.displayName = displayName;
        if (avatarUrl !== undefined) patch.avatarUrl = avatarUrl;
        try {
            const updated =
                kind === 'teacher'
                    ? await updateTeacher(id, patch)
                    : await updateStudent(id, patch);
            if (!updated) {
                return res.status(404).json({ error: 'not_found' });
            }
            res.json({
                ok: true,
                user: {
                    userId: userRef,
                    kind,
                    id,
                    username: updated.username,
                    displayName: updated.displayName,
                    avatarUrl: updated.avatarUrl || '',
                },
            });
        } catch (err) {
            console.error('PATCH /service/lobby/user-profile:', err);
            res.status(500).json({ error: 'profile_update_failed' });
        }
    });

    app.get('/service/lobby/favorites', authRead, async (req, res) => {
        const userRef = String(req.query?.userRef || req.query?.userId || '').trim();
        if (!parseLobbyUserRef(userRef)) {
            return res.status(400).json({ error: 'invalid_user_ref' });
        }
        try {
            const worldIds = await listLobbyWorldFavorites(userRef);
            res.json({ ok: true, userRef, worldIds });
        } catch (err) {
            console.error('GET /service/lobby/favorites:', err);
            res.status(500).json({ error: 'favorites_list_failed' });
        }
    });

    app.patch('/service/lobby/favorites', authUserWrite, async (req, res) => {
        const userRef = String(req.body?.userRef || req.body?.userId || '').trim();
        if (!parseLobbyUserRef(userRef)) {
            return res.status(400).json({ error: 'invalid_user_ref' });
        }
        const worldId = normalizeLobbyWorldSlug(req.body?.worldId ?? req.body?.worldSlug ?? req.body?.slug);
        if (!worldId) {
            return res.status(400).json({ error: 'invalid_world_id' });
        }
        const favorite = req.body?.favorite;
        if (typeof favorite !== 'boolean') {
            return res.status(400).json({ error: 'favorite_boolean_required' });
        }
        try {
            await setLobbyWorldFavorite(userRef, worldId, favorite);
            const worldIds = await listLobbyWorldFavorites(userRef);
            res.json({ ok: true, userRef, worldId, favorite, worldIds });
        } catch (err) {
            console.error('PATCH /service/lobby/favorites:', err);
            res.status(500).json({ error: 'favorites_update_failed' });
        }
    });

    app.post('/service/lobby/favorites/toggle', authUserWrite, async (req, res) => {
        const userRef = String(req.body?.userRef || req.body?.userId || '').trim();
        if (!parseLobbyUserRef(userRef)) {
            return res.status(400).json({ error: 'invalid_user_ref' });
        }
        const worldId = normalizeLobbyWorldSlug(req.body?.worldId ?? req.body?.worldSlug ?? req.body?.slug);
        if (!worldId) {
            return res.status(400).json({ error: 'invalid_world_id' });
        }
        try {
            const result = await toggleLobbyWorldFavorite(userRef, worldId);
            const worldIds = await listLobbyWorldFavorites(userRef);
            res.json({
                ok: true,
                userRef,
                worldId,
                favorite: result.favorite,
                toggled: result.toggled,
                worldIds,
            });
        } catch (err) {
            console.error('POST /service/lobby/favorites/toggle:', err);
            res.status(500).json({ error: 'favorites_toggle_failed' });
        }
    });

    app.get('/service/lobby/share-join/:tenantId', authRead, (req, res) => {
        const resolved = resolveShareJoinTarget(req.params.tenantId);
        if (!resolved.ok) {
            return res.status(resolved.status).json({ error: resolved.error });
        }
        return res.json({
            ok: true,
            tenantId: resolved.tenantId,
            worldName: resolved.worldName,
            displayName: resolved.displayName,
            shareUrl: resolved.shareUrl,
            maintenance: resolved.maintenance,
        });
    });

    app.post('/service/lobby/share-join/:tenantId/join', authRead, shareJoinJoinRateLimit, async (req, res) => {
        const resolved = resolveShareJoinTarget(req.params.tenantId);
        if (!resolved.ok) {
            return res.status(resolved.status).json({ error: resolved.error });
        }
        if (resolved.maintenance) {
            return res.status(503).json({ error: 'maintenance', maintenance: true });
        }
        const displayName = String(req.body?.displayName || '').trim();
        if (!displayName) {
            return res.status(400).json({ error: 'display_name_required' });
        }
        if (displayName.length > 64) {
            return res.status(400).json({ error: 'name_too_long', maxLength: 64 });
        }
        if (!/^[\p{L}\p{N}_\- ]+$/u.test(displayName)) {
            return res.status(400).json({ error: 'invalid_name_chars' });
        }
        const moderation = await moderateDisplayNameForJoin({ displayName });
        if (!moderation.allowed) {
            return res.status(422).json({
                error: 'display_name_rejected',
                reason_ja: moderation.reason_ja || undefined,
            });
        }
        const tenant = getTenant(resolved.tenantId);
        let socketJoinToken = null;
        if (tenant) {
            const minted = mintTenantSocketJoinToken(tenant);
            socketJoinToken = minted?.joinToken ?? null;
        }
        const displayJoinToken = mintLobbyDisplayNameJoinToken(displayName);
        if (!displayJoinToken) {
            return res.status(500).json({ error: 'display_join_token_unavailable' });
        }
        return res.json({
            ok: true,
            tenantId: resolved.tenantId,
            entryUrl: resolved.entryUrl,
            socketJoinToken,
            displayJoinToken,
        });
    });

    app.post('/service/lobby/kick', authKick, (req, res) => {
        const userRef = String(req.body?.userRef || req.body?.userId || '').trim();
        const displayName = String(req.body?.displayName || '').trim();
        const result = kickLobbyUser({ userRef, displayName });
        if (!result.ok) {
            return res.status(result.status || 400).json(result);
        }
        let kicked = 0;
        for (const socketId of result.socketIds || []) {
            if (executeKickForSocket(socketId)) kicked += 1;
        }
        res.json({ ...result, kicked });
    });
}