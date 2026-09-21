// lib/platform-admin.js — /admin ルート（最小構成）
import path from 'node:path';
import { createAdminCsrfBundle } from './admin-csrf.js';
import {
    createBasicAuthMiddleware,
    adminPanelCspMiddleware,
    resolveAdminCredentials,
} from './admin-auth.js';
import { getHttpTrafficSnapshot } from './http-traffic-metrics.js';
import { formatBytes, getServerLoadMetrics } from './platform-stats.js';
import { getTenant, listTenants } from './tenant-registry.js';
import { readTenantWorlds } from './tenant-api.js';
import {
    getPlatformSocketTotals,
    getTenantSocketStatsList,
} from './tenant-socket.js';
import { createTenant, archiveTenant } from './tenant-lifecycle.js';
import { registerTenantWorldAdminRoutes } from './tenant-world-admin.js';
import {
    buildAdminMetaverseTokenClearCookie,
    buildAdminMetaverseTokenSetCookie,
    generateAdminToken,
    isSecureAdminCookieRequest,
} from './admin-metaverse-token.js';
import { getClientIpFromRequest } from './client-ip.js';
import {
    getNetworkConfigForAdmin,
    getTenantPublicUrl,
    mergeTenantNetworkEntries,
    reloadNetworkConfig,
    saveNetworkConfigToDisk,
    validateNetworkConfigPayload,
} from './platform-network-config.js';
import { reloadPlatformSettings } from './platform-reload.js';
import {
    getPlannedRestartPublicState,
    normalizePlannedRestartDelay,
    normalizePlannedRestartMessage,
    requestForcePlatformRestart,
    schedulePlannedPlatformRestart,
} from './platform-planned-restart.js';
import {
    getEnvConfigForAdmin,
    saveEnvConfigFromAdmin,
} from './platform-env-config.js';
import {
    getR2ConnectionStatusForAdmin,
    runR2ConnectionTest,
} from './r2/r2-connection-test.js';
import { createAdminRouteRateLimit } from './http-rate-limit.js';

/**
 * @param {import('express').Express} app
 * @param {{ staticDir: string }} options
 */
export function registerPlatformAdmin(app, options) {
    const { username, password } = resolveAdminCredentials();
    const adminRateLimit = createAdminRouteRateLimit();
    const basicAuth = createBasicAuthMiddleware(username, password);
    const csrfBundle = createAdminCsrfBundle(password);
    const { adminCsrfProtection, registerAdminCsrfRoute } = csrfBundle;

    app.use('/admin', adminRateLimit);
    app.use('/admin', basicAuth);
    app.use('/admin', adminCsrfProtection);
    registerAdminCsrfRoute(app);

    const adminTenantHtml = path.join(options.staticDir, 'admin-tenant.html');
    const adminTenantWorldEditHtml = path.join(options.staticDir, 'admin-tenant-world-edit.html');
    const adminHtmlGuards = [adminRateLimit, adminPanelCspMiddleware, basicAuth];

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

    app.get('/admin/enter-metaverse', (req, res) => {
        const clientIp = getClientIpFromRequest(req);
        if (!clientIp) {
            return res.status(503).json({ error: 'client_ip_unavailable' });
        }
        const mode = String(req.query?.mode || 'default').trim() === 'camera' ? 'camera' : 'default';
        const issued = generateAdminToken(mode, clientIp);
        const secureCookie = isSecureAdminCookieRequest(req);
        res.setHeader(
            'Set-Cookie',
            buildAdminMetaverseTokenSetCookie(issued.token, { secure: secureCookie })
        );
        res.json({
            token: issued.token,
            username: mode === 'camera' && issued.username ? issued.username : 'admin',
            mode,
        });
    });

    app.get('/admin/clear-metaverse-token', (req, res) => {
        const secureCookie = isSecureAdminCookieRequest(req);
        res.setHeader(
            'Set-Cookie',
            buildAdminMetaverseTokenClearCookie({ secure: secureCookie })
        );
        res.json({ ok: true });
    });

    app.get('/admin/stats', (_req, res) => {
        const load = getServerLoadMetrics();
        const socket = getPlatformSocketTotals();
        const traffic = getHttpTrafficSnapshot();
        res.json({
            service: 'metaverse-simulation-platform',
            totalPlayers: socket.totalPlayers,
            totalRooms: socket.totalRooms,
            tenantCount: socket.tenantCount,
            cpuUsagePercent: load.cpuUsagePercent,
            ramUsagePercent: load.ramUsagePercent,
            commPerSecond: traffic.bytesPerSecond,
            degradationIndex: traffic.bytesPerSecond / (30 * 1024 * 1024),
            traffic: {
                ...traffic,
                bytesSentTotalHuman: formatBytes(traffic.bytesSentTotal),
                bytesSentLastWindowHuman: formatBytes(traffic.bytesSentLastWindow),
                bytesPerSecondHuman: `${formatBytes(traffic.bytesPerSecond)}/s`,
            },
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

    app.post('/admin/tenants', async (req, res) => {
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

    app.delete('/admin/tenants/:tenantId', async (req, res) => {
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

        const traffic = getHttpTrafficSnapshot(tenant);
        res.json({
            tenantId: tenant.id,
            displayName: tenant.displayName,
            players: sock.players,
            rooms: sock.rooms,
            worldCount,
            url: getTenantPublicUrl(tenant.id) || `/${tenant.id}/`,
            worldsPath: tenant.paths.WORLDS_PATH,
            traffic: {
                ...traffic,
                bytesSentTotalHuman: formatBytes(traffic.bytesSentTotal),
                bytesSentLastWindowHuman: formatBytes(traffic.bytesSentLastWindow),
                bytesPerSecondHuman: `${formatBytes(traffic.bytesPerSecond)}/s`,
                topPaths: traffic.topPaths.map((row) => ({
                    ...row,
                    bytesHuman: formatBytes(row.bytes),
                })),
            },
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

    app.get('/admin/env-config', (_req, res) => {
        res.json(getEnvConfigForAdmin());
    });

    app.put('/admin/env-config', (req, res) => {
        const values = req.body?.values;
        if (!values || typeof values !== 'object') {
            return res.status(400).json({
                error: 'invalid_payload',
                message: 'values オブジェクトが必要です',
            });
        }
        const saved = saveEnvConfigFromAdmin(values);
        if (!saved.ok) {
            return res.status(400).json({
                error: 'invalid_env_config',
                errors: saved.errors,
            });
        }
        try {
            reloadPlatformSettings();
            const view = getEnvConfigForAdmin();
            const requiresRestart = saved.requiresRestart ?? [];
            return res.json({
                ok: true,
                config: view,
                requiresRestart,
                changedKeys: saved.changedKeys,
                message:
                    requiresRestart.length > 0
                        ? `設定を保存しました。再起動が必要な項目: ${requiresRestart.join(', ')}`
                        : '設定を保存し、即時反映しました。',
            });
        } catch (e) {
            console.error('[admin] env-config save failed:', e);
            return res.status(500).json({
                error: 'save_failed',
                message: e instanceof Error ? e.message : '保存に失敗しました',
            });
        }
    });

    app.get('/admin/r2-storage-status', (_req, res) => {
        res.json(getR2ConnectionStatusForAdmin());
    });

    app.post('/admin/r2-connection-test', async (_req, res) => {
        try {
            const result = await runR2ConnectionTest();
            if (!result.ok) {
                return res.status(400).json({
                    ok: false,
                    error: result.error,
                    status: result.status,
                });
            }
            return res.json({
                ok: true,
                message: 'R2 接続完了',
                status: result.status,
            });
        } catch (e) {
            console.error('[admin] r2-connection-test failed:', e);
            return res.status(500).json({
                ok: false,
                error: e instanceof Error ? e.message : 'R2 接続テストに失敗しました',
                status: getR2ConnectionStatusForAdmin(),
            });
        }
    });

    app.get('/admin/network-config', (_req, res) => {
        res.json(getNetworkConfigForAdmin());
    });

    app.put('/admin/network-config', (req, res) => {
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

    app.post('/admin/reload-settings', (_req, res) => {
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

    app.get('/admin/planned-restart', (_req, res) => {
        const planned = getPlannedRestartPublicState();
        return res.json({ ok: true, planned });
    });

    app.post('/admin/restart', (req, res) => {
        const mode = req.body?.mode === 'planned' ? 'planned' : 'force';

        if (mode === 'planned') {
            const delayResult = normalizePlannedRestartDelay(
                req.body?.delayMinutes,
                req.body?.delaySeconds
            );
            if ('error' in delayResult) {
                return res.status(400).json({ ok: false, error: 'invalid_delay', message: delayResult.error });
            }
            const messageResult = normalizePlannedRestartMessage(req.body?.message);
            if ('error' in messageResult) {
                return res.status(400).json({ ok: false, error: 'invalid_message', message: messageResult.error });
            }
            const planned = schedulePlannedPlatformRestart({
                delayMs: delayResult.delayMs,
                message: messageResult.message,
            });
            return res.json({
                ok: true,
                mode: 'planned',
                planned,
                message: `計画再起動を予約しました（${new Date(planned.restartAtMs).toLocaleString('ja-JP')}）`,
            });
        }

        res.json({
            ok: true,
            mode: 'force',
            message: 'サーバーを再起動しています。数秒後に接続が復旧します。',
        });
        setTimeout(() => {
            try {
                requestForcePlatformRestart();
            } catch (e) {
                console.error('[admin] restart failed:', e);
                process.exit(1);
            }
        }, 300);
    });
}
