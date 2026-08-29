// lib/platform-admin.js — /admin ルート（最小構成）
import path from 'node:path';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { createAdminCsrfBundle } from './admin-csrf.js';
import {
    createBasicAuthMiddleware,
    adminPanelCspMiddleware,
    resolveAdminCredentials,
} from './admin-auth.js';
import { getServerLoadMetrics } from './platform-stats.js';
import { getTenant, listTenants } from './tenant-registry.js';
import { readTenantWorlds } from './tenant-api.js';
import {
    getPlatformSocketTotals,
    getTenantSocketStatsList,
} from './tenant-socket.js';
import { createTenant, archiveTenant } from './tenant-lifecycle.js';
import { registerTenantWorldAdminRoutes } from './tenant-world-admin.js';
import {
    getNetworkConfigForAdmin,
    getTenantPublicUrl,
    mergeTenantNetworkEntries,
    reloadNetworkConfig,
    saveNetworkConfigToDisk,
    validateNetworkConfigPayload,
} from './platform-network-config.js';
import { reloadPlatformSettings, requestPlatformRestart } from './platform-reload.js';

/**
 * @param {import('express').Express} app
 * @param {{ staticDir: string }} options
 */
export function registerPlatformAdmin(app, options) {
    const { username, password } = resolveAdminCredentials();
    const basicAuth = createBasicAuthMiddleware(username, password);
    const csrfBundle = createAdminCsrfBundle(password);
    const { adminCsrfProtection, registerAdminCsrfRoute } = csrfBundle;

    const adminAuthIpLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 40,
        skipSuccessfulRequests: true,
        standardHeaders: true,
        legacyHeaders: false,
    });

    const tenantLifecycleLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 10,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'rate_limit', message: 'Too many tenant lifecycle requests' },
    });

    const platformReloadLimiter = rateLimit({
        windowMs: 60 * 1000,
        max: 12,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'rate_limit', message: 'Too many reload requests' },
    });

    const platformRestartLimiter = rateLimit({
        windowMs: 15 * 60 * 1000,
        max: 5,
        standardHeaders: true,
        legacyHeaders: false,
        message: { error: 'rate_limit', message: 'Too many restart requests' },
    });

    app.use('/admin', adminAuthIpLimiter);
    app.use('/admin', basicAuth);
    app.use('/admin', adminCsrfProtection);
    registerAdminCsrfRoute(app);

    const adminTenantHtml = path.join(options.staticDir, 'admin-tenant.html');
    const adminTenantWorldEditHtml = path.join(options.staticDir, 'admin-tenant-world-edit.html');
    const adminHtmlGuards = [adminPanelCspMiddleware, basicAuth];

    app.get('/admin.html', adminHtmlGuards, (_req, res) => {
        res.sendFile(path.join(options.staticDir, 'admin.html'));
    });

    app.get('/admin-tenant.html', adminHtmlGuards, (req, res) => {
        const tenantId = String(req.query.tenant || '').trim();
        if (tenantId && getTenant(tenantId)) {
            return res.redirect(302, `/admin/tenant/${encodeURIComponent(tenantId)}`);
        }
        res.sendFile(adminTenantHtml);
    });

    app.get('/admin/tenant/:tenantId', adminHtmlGuards, (req, res) => {
        const tenantId = String(req.params.tenantId || '').trim();
        if (!getTenant(tenantId)) {
            return res.status(404).type('text/plain').send('Tenant not found');
        }
        res.sendFile(adminTenantHtml);
    });

    app.get('/admin/tenant/:tenantId/', adminHtmlGuards, (req, res) => {
        const tenantId = String(req.params.tenantId || '').trim();
        if (!getTenant(tenantId)) {
            return res.status(404).type('text/plain').send('Tenant not found');
        }
        res.sendFile(adminTenantHtml);
    });

    app.get('/admin/tenant/:tenantId/world-edit', adminHtmlGuards, (req, res) => {
        const tenantId = String(req.params.tenantId || '').trim();
        if (!getTenant(tenantId)) {
            return res.status(404).type('text/plain').send('Tenant not found');
        }
        res.sendFile(adminTenantWorldEditHtml);
    });

    app.get('/admin/tenant/:tenantId/world-edit/', adminHtmlGuards, (req, res) => {
        const tenantId = String(req.params.tenantId || '').trim();
        if (!getTenant(tenantId)) {
            return res.status(404).type('text/plain').send('Tenant not found');
        }
        res.sendFile(adminTenantWorldEditHtml);
    });

    registerTenantWorldAdminRoutes(app);

    app.get('/admin', (_req, res) => {
        res.redirect(302, '/admin.html');
    });
    app.get('/admin/', (_req, res) => {
        res.redirect(302, '/admin.html');
    });

    app.get('/admin/stats', (_req, res) => {
        const load = getServerLoadMetrics();
        const socket = getPlatformSocketTotals();
        res.json({
            service: 'metaverse-simulation-platform',
            totalPlayers: socket.totalPlayers,
            totalRooms: socket.totalRooms,
            tenantCount: socket.tenantCount,
            cpuUsagePercent: load.cpuUsagePercent,
            ramUsagePercent: load.ramUsagePercent,
            commPerSecond: load.commPerSecond,
            degradationIndex: load.degradationIndex,
        });
    });

    app.get('/admin/tenants', (_req, res) => {
        const socketStats = getTenantSocketStatsList();
        const socketMap = new Map(socketStats.map((s) => [s.tenantId, s]));
        const tenants = listTenants().map((t) => {
            const worlds = readTenantWorlds(t);
            const worldCount = worlds ? Object.keys(worlds).length : 0;
            const sock = socketMap.get(t.id) ?? { players: 0, rooms: 0 };
            return {
                id: t.id,
                displayName: t.displayName,
                url: getTenantPublicUrl(t.id) || `/${t.id}/`,
                players: sock.players,
                rooms: sock.rooms,
                worldCount,
                worldsPath: t.paths.WORLDS_PATH,
            };
        });
        res.json({ tenants });
    });

    app.post('/admin/tenants', tenantLifecycleLimiter, async (req, res) => {
        const id = String(req.body?.id ?? '').trim();
        const displayName = req.body?.displayName;
        const result = await createTenant({ id, displayName });
        if (!result.ok) {
            const status =
                result.code === 'already_exists' ? 409
                : result.code === 'reserved_id' || result.code === 'invalid_id' ? 400
                : 500;
            return res.status(status).json({
                error: result.code,
                message: result.error,
            });
        }

        const network = req.body?.network;
        if (network && typeof network === 'object') {
            const merged = mergeTenantNetworkEntries(network);
            if (!merged.ok) {
                return res.status(400).json({
                    error: 'invalid_network',
                    message: merged.error,
                });
            }
        }

        const publicUrl = getTenantPublicUrl(id) || `/${id}/`;
        return res.status(201).json({
            tenant: {
                ...result.tenant,
                url: publicUrl,
            },
        });
    });

    app.delete('/admin/tenants/:tenantId', tenantLifecycleLimiter, async (req, res) => {
        const tenantId = String(req.params.tenantId || '').trim();
        const force =
            req.body?.force === true
            || String(req.query?.force ?? '').toLowerCase() === 'true'
            || String(req.query?.force ?? '') === '1';
        const result = await archiveTenant(tenantId, { force });
        if (!result.ok) {
            const status =
                result.code === 'tenant_not_found' ? 404
                : result.code === 'players_connected' ? 409
                : 500;
            return res.status(status).json({
                error: result.code,
                message: result.error,
                players: result.players,
            });
        }
        return res.json({
            ok: true,
            tenantId,
            archivedPath: result.archivedPath,
        });
    });

    app.get('/admin/tenants/:tenantId/stats', (req, res) => {
        const tenantId = String(req.params.tenantId || '').trim();
        const tenant = getTenant(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'tenant_not_found', tenantId });
        }

        const socketStats = getTenantSocketStatsList();
        const sock = socketStats.find((s) => s.tenantId === tenantId) ?? {
            tenantId,
            players: 0,
            rooms: 0,
        };
        const worlds = readTenantWorlds(tenant);
        const worldCount = worlds ? Object.keys(worlds).length : 0;

        res.json({
            tenantId: tenant.id,
            displayName: tenant.displayName,
            players: sock.players,
            rooms: sock.rooms,
            worldCount,
            url: getTenantPublicUrl(tenant.id) || `/${tenant.id}/`,
            worldsPath: tenant.paths.WORLDS_PATH,
        });
    });

    app.get('/admin/tenants/:tenantId/worlds', (req, res) => {
        const tenantId = String(req.params.tenantId || '').trim();
        const tenant = getTenant(tenantId);
        if (!tenant) {
            return res.status(404).json({ error: 'tenant_not_found', tenantId });
        }

        const worlds = readTenantWorlds(tenant);
        if (!worlds) {
            return res.status(500).json({
                error: 'worlds_unavailable',
                tenantId: tenant.id,
            });
        }

        res.json(worlds);
    });

    app.get('/admin/network-config', (_req, res) => {
        res.json(getNetworkConfigForAdmin());
    });

    app.put('/admin/network-config', tenantLifecycleLimiter, (req, res) => {
        const validated = validateNetworkConfigPayload(req.body);
        if (!validated.ok) {
            return res.status(400).json({
                error: 'invalid_network_config',
                errors: validated.errors,
            });
        }
        try {
            saveNetworkConfigToDisk(validated.config);
            reloadNetworkConfig();
            const view = getNetworkConfigForAdmin();
            return res.json({
                ok: true,
                config: view,
                message: view.needsRestartForPort
                    ? '設定を保存しました。PORT 変更を反映するにはサーバーを再起動してください。'
                    : '設定を保存しました。ナビリンクは即時反映されます。',
            });
        } catch (e) {
            console.error('[admin] network-config save failed:', e);
            return res.status(500).json({
                error: 'save_failed',
                message: e instanceof Error ? e.message : '保存に失敗しました',
            });
        }
    });

    app.post('/admin/reload-settings', platformReloadLimiter, (_req, res) => {
        try {
            const result = reloadPlatformSettings();
            return res.json({
                ok: true,
                ...result,
                message:
                    '設定を再読み込みしました。ナビリンク・Tenant 一覧は即時反映されます。PORT 変更は再起動が必要です。',
            });
        } catch (e) {
            console.error('[admin] reload-settings failed:', e);
            return res.status(500).json({
                error: 'reload_failed',
                message: e instanceof Error ? e.message : '再読み込みに失敗しました',
            });
        }
    });

    app.post('/admin/restart', platformRestartLimiter, (_req, res) => {
        res.json({
            ok: true,
            message: 'サーバーを再起動しています。数秒後に接続が復旧します。',
        });
        setTimeout(() => {
            try {
                requestPlatformRestart();
            } catch (e) {
                console.error('[admin] restart failed:', e);
                process.exit(1);
            }
        }, 300);
    });
}
