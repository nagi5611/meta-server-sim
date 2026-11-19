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