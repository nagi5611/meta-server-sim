// lib/tenant-plugin-admin-routes.js — /admin/tenant/:tenantId/plugins
import {
    getTenantPluginConfigMap,
    setTenantPluginConfigBulk,
} from '../db/tenant-plugins-registry.js';
import { getTenant } from './tenant-registry.js';
import {
    listTenantPluginsForAdmin,
    reloadTenantPlugins,
    setTenantPluginEnabledWithValidation,
} from './tenant-plugin-runtime.js';
import { refreshPlatformAdminPluginRoutesFromContext } from './tenant-plugin-platform-admin.js';

/**
 * @param {import('express').Express} app
 * @param {{ basicAuth: import('express').RequestHandler, adminRateLimit: import('express').RequestHandler, adminCsrfProtection: import('express').RequestHandler }} guards
 * @param {() => import('express').Router | null} getTenantRouter
 */
export function registerTenantPluginAdminRoutes(app, guards, getTenantRouter) {
    const { basicAuth, adminRateLimit, adminCsrfProtection } = guards;
    const readStack = [adminRateLimit, basicAuth];
    const writeStack = [adminRateLimit, basicAuth, adminCsrfProtection];

    app.get('/admin/tenant/:tenantId/plugins', readStack, (req, res) => {
        const tenantId = String(req.params.tenantId || '').trim();
        const tenant = getTenant(tenantId);
        if (!tenant) {
            return res.status(404).json({ ok: false, message: 'tenant not found' });
        }
        return res.json({
            ok: true,
            tenantId,
            plugins: listTenantPluginsForAdmin(tenant),
        });
    });

    app.get('/admin/tenant/:tenantId/plugins/:pluginId/config', readStack, (req, res) => {
        const tenantId = String(req.params.tenantId || '').trim();
        const pluginId = String(req.params.pluginId || '').trim();
        const tenant = getTenant(tenantId);
        if (!tenant) {
            return res.status(404).json({ ok: false, message: 'tenant not found' });
        }
        const values = getTenantPluginConfigMap(tenantId, pluginId);
        return res.json({ ok: true, tenantId, pluginId, values });
    });

    app.put('/admin/tenant/:tenantId/plugins/:pluginId/config', writeStack, (req, res) => {
        const tenantId = String(req.params.tenantId || '').trim();
        const pluginId = String(req.params.pluginId || '').trim();
        const tenant = getTenant(tenantId);
        if (!tenant) {
            return res.status(404).json({ ok: false, message: 'tenant not found' });
        }
        const updates = req.body?.updates;
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ ok: false, message: 'updates object required' });
        }
        /** @type {Record<string, string>} */
        const normalized = {};
        for (const [k, v] of Object.entries(updates)) {
            normalized[String(k)] = String(v ?? '');
        }
        setTenantPluginConfigBulk(tenantId, pluginId, normalized);
        return res.json({
            ok: true,
            tenantId,
            pluginId,
            restartRequired: true,
            message: 'Config saved. POST .../plugins/reload to apply server hooks; client may need refresh.',
        });
    });

    app.post('/admin/tenant/:tenantId/plugins/:pluginId/enable', writeStack, async (req, res) => {
        const tenantId = String(req.params.tenantId || '').trim();
        const pluginId = String(req.params.pluginId || '').trim();
        const tenant = getTenant(tenantId);
        if (!tenant) {
            return res.status(404).json({ ok: false, message: 'tenant not found' });
        }
        const result = setTenantPluginEnabledWithValidation(tenant, pluginId, true);
        if (!result.ok) {
            return res.status(400).json({
                ok: false,
                message: result.errors?.join('; ') || 'enable failed',
            });
        }
        return res.json({
            ok: true,
            tenantId,
            pluginId,
            enabled: true,
            restartRequired: true,
        });
    });

    app.post('/admin/tenant/:tenantId/plugins/:pluginId/disable', writeStack, (req, res) => {
        const tenantId = String(req.params.tenantId || '').trim();
        const pluginId = String(req.params.pluginId || '').trim();
        const tenant = getTenant(tenantId);
        if (!tenant) {
            return res.status(404).json({ ok: false, message: 'tenant not found' });
        }
        setTenantPluginEnabledWithValidation(tenant, pluginId, false);
        return res.json({
            ok: true,
            tenantId,
            pluginId,
            enabled: false,
            restartRequired: true,
        });
    });

    app.post('/admin/tenant/:tenantId/plugins/reload', writeStack, async (req, res) => {
        const tenantId = String(req.params.tenantId || '').trim();
        const tenant = getTenant(tenantId);
        if (!tenant) {
            return res.status(404).json({ ok: false, message: 'tenant not found' });
        }
        const tenantRouter = getTenantRouter();
        if (!tenantRouter) {
            return res.status(503).json({ ok: false, message: 'tenant router unavailable' });
        }
        try {
            const report = await reloadTenantPlugins(tenant, tenantRouter);
            await refreshPlatformAdminPluginRoutesFromContext();
            return res.json({ ok: true, tenantId, report });
        } catch (e) {
            return res.status(500).json({
                ok: false,
                message: e instanceof Error ? e.message : 'reload failed',
            });
        }
    });
}
