// lib/platform-lobby-admin-routes.js — 管理画面からロビーカタログ編集
import {
    buildLobbyWorkerRegistry,
    loadLobbyCatalog,
    saveLobbyCatalog,
} from './platform-lobby-catalog.js';
import { syncLobbyCatalogToWorker } from './platform-lobby-sync.js';
import { isLobbyEntryUrlAllowed, lobbyEntryUrlPolicyHintJa } from './lobby-entry-url-policy.js';

function normalizeEntryForAdmin(raw) {
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
 * @param {import('express').RequestHandler[]} stack
 */
export function registerPlatformLobbyAdminRoutes(app, stack) {
    app.get('/admin/lobby-catalog', stack, (_req, res) => {
        res.json(loadLobbyCatalog());
    });

    app.put('/admin/lobby-catalog', stack, async (req, res) => {
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
        const metaverses = body.metaverses.map(normalizeEntryForAdmin).filter(Boolean);
        const saved = saveLobbyCatalog({ metaverses });
        const sync = await syncLobbyCatalogToWorker(saved);
        res.json({
            ok: true,
            catalog: saved,
            workerSync: sync,
            workerPreview: buildLobbyWorkerRegistry(saved),
        });
    });

    app.post('/admin/lobby-catalog/sync', stack, async (_req, res) => {
        const catalog = loadLobbyCatalog();
        const sync = await syncLobbyCatalogToWorker(catalog);
        if (!sync.ok) {
            return res.status(502).json({ error: 'worker_sync_failed', detail: sync });
        }
        res.json({ ok: true, workerSync: sync });
    });
}