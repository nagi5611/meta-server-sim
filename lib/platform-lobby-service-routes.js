// Service routes for lobby Worker (Bearer LOBBY_SIM_SERVICE_TOKEN only)

import {
    buildLobbyWorkerRegistry,
    loadLobbyCatalog,
    saveLobbyCatalog,
} from './platform-lobby-catalog.js';
import { syncLobbyCatalogToWorker } from './platform-lobby-sync.js';
import { lobbyServiceBearerAuth } from './lobby-service-auth.js';
import {
    executeKickForSocket,
    getLobbyPresenceIndex,
    kickLobbyUser,
} from './platform-lobby-presence-registry.js';
import {
    listStudents,
    listTeachers,
    patchLobbyUserFlags,
    updateStudent,
    updateTeacher,
    verifyStudent,
    verifyTeacher,
} from '../db/users.js';
import { sendLobbyPasswordResetEmail } from './lobby-password-reset.js';

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
    app.use('/service', lobbyServiceBearerAuth);

    app.get('/service/lobby-catalog', (_req, res) => {
        res.json(loadLobbyCatalog());
    });

    app.put('/service/lobby-catalog', async (req, res) => {
        const body = req.body;
        if (!body || !Array.isArray(body.metaverses)) {
            return res.status(400).json({ error: 'invalid_payload', message: 'metaverses[] required' });
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

    app.post('/service/lobby-catalog/sync', async (_req, res) => {
        const catalog = loadLobbyCatalog();
        const sync = await syncLobbyCatalogToWorker(catalog);
        if (!sync.ok) {
            return res.status(502).json({ error: 'worker_sync_failed', detail: sync });
        }
        res.json({ ok: true, workerSync: sync });
    });

    app.get('/service/users/students', async (_req, res) => {
        try {
            res.json(await listStudents());
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/service/users/teachers', async (_req, res) => {
        try {
            res.json(await listTeachers());
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.patch('/service/users/:kind/:id', async (req, res) => {
        const kind = String(req.params.kind || '');
        if (kind !== 'student' && kind !== 'teacher') {
            return res.status(400).json({ error: 'invalid_kind' });
        }
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) return res.status(400).json({ error: 'invalid_id' });
        try {
            const updated = await patchLobbyUserFlags(kind, id, req.body || {});
            if (!updated) return res.status(404).json({ error: 'not_found' });
            res.json(updated);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.get('/service/lobby/presence-index', (_req, res) => {
        res.json({ entries: getLobbyPresenceIndex() });
    });

    app.post('/service/lobby/admin-login', async (req, res) => {
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
            const lobbyRole = user.lobbyRole || (kind === 'teacher' ? 'admin' : 'user');
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
                    lobbyRole,
                },
            });
        } catch (err) {
            console.error('POST /service/lobby/admin-login:', err);
            res.status(500).json({ error: 'login_failed' });
        }
    });

    app.post('/service/users/:kind/:id/password-reset', async (req, res) => {
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

    app.patch('/service/lobby/user-profile', async (req, res) => {
        const userRef = String(req.body?.userRef || req.body?.userId || '').trim();
        const displayName = String(req.body?.displayName || req.body?.name || '').trim();
        const m = /^((?:student|teacher))-(\d+)$/.exec(userRef);
        if (!m) {
            return res.status(400).json({ error: 'invalid_user_ref' });
        }
        if (!displayName) {
            return res.status(400).json({ error: 'name_required' });
        }
        if (displayName.length > 64) {
            return res.status(400).json({ error: 'name_too_long', maxLength: 64 });
        }
        if (!/^[\p{L}\p{N}_\- ]+$/u.test(displayName)) {
            return res.status(400).json({ error: 'invalid_name_chars' });
        }
        const kind = m[1];
        const id = Number(m[2]);
        try {
            const updated =
                kind === 'teacher'
                    ? await updateTeacher(id, { displayName })
                    : await updateStudent(id, { displayName });
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
                },
            });
        } catch (err) {
            console.error('PATCH /service/lobby/user-profile:', err);
            res.status(500).json({ error: 'profile_update_failed' });
        }
    });

    app.post('/service/lobby/kick', (req, res) => {
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