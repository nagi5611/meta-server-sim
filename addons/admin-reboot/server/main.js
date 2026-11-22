// addons/admin-reboot/server/main.js — テナントスコープの安全な再起動（プラグイン再読込のみ）
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import { getSharedTenantRouter, reloadTenantPlugins } from '../../../lib/tenant-plugin-runtime.js';
const JSON_BODY_LIMIT = '8kb';
const isNodeProduction = process.env.NODE_ENV === 'production';

/**
 * @param {unknown} value
 * @param {boolean} fallback
 */
function parseBoolean(value, fallback) {
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
    return fallback;
}

/**
 * @param {string} a
 * @param {string} b
 */
function safeStringEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ba = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
}

/**
 * @param {import('express').Application} app
 * @param {string} base `/admin/tenants/:tenantId`
 * @param {import('express').RequestHandler} attachTenant
 */
export function attachAdminRebootTenantAdminRoutes(app, base, attachTenant) {
    const api = `${base}/addons/admin-reboot`;
    const jsonMw = express.json({ limit: JSON_BODY_LIMIT });

    app.get(`${api}/capabilities`, attachTenant, (req, res) => {
        const cfgPin =
            typeof req.tenant?.env?.ADDON_ADMIN_REBOOT_PIN === 'string'
                ? req.tenant.env.ADDON_ADMIN_REBOOT_PIN.trim()
                : '';
        res.json({
            ok: true,
            plugin: 'admin-reboot',
            tenantId: req.tenant.id,
            allowHostRestart: false,
            allowTenantPluginReload: true,
            pinRequired: isNodeProduction || cfgPin.length > 0,
            strategy: 'tenant-plugin-reload',
            note: 'ホスト全体の再起動は Fleet ops / WS-8 のみ。systemctl は呼びません。',
        });
    });

    app.post(`${api}/reload-tenant-plugins`, attachTenant, jsonMw, async (req, res) => {
        const cfgPin =
            typeof req.tenant?.env?.ADDON_ADMIN_REBOOT_PIN === 'string'
                ? req.tenant.env.ADDON_ADMIN_REBOOT_PIN.trim()
                : '';
        const pinRequired = isNodeProduction || cfgPin.length > 0;
        if (pinRequired) {
            if (!cfgPin) {
                return res.status(503).json({ ok: false, error: 'reboot_pin_not_configured' });
            }
            const given = typeof req.body?.pin === 'string' ? req.body.pin : '';
            if (!safeStringEqual(given, cfgPin)) {
                return res.status(403).json({ ok: false, error: 'invalid_pin' });
            }
        }
        const tenantRouter = getSharedTenantRouter();
        if (!tenantRouter) {
            return res.status(503).json({ ok: false, error: 'tenant_router_unavailable' });
        }
        try {
            const report = await reloadTenantPlugins(req.tenant, tenantRouter);
            try {
                const { refreshPlatformAdminPluginRoutesFromContext } = await import(
                    '../../../lib/tenant-plugin-platform-admin.js'
                );
                await refreshPlatformAdminPluginRoutesFromContext();
            } catch {
                /* platform admin sync optional in tests */
            }
            return res.json({ ok: true, tenantId: req.tenant.id, report });
        } catch (e) {
            return res.status(500).json({
                ok: false,
                error: e instanceof Error ? e.message : 'reload_failed',
            });
        }
    });

    app.post(`${api}/restart-node`, attachTenant, (_req, res) => {
        res.status(403).json({
            ok: false,
            error: 'host_restart_disabled',
            message: 'sim ではホスト systemd 再起動は禁止です。Fleet ops を利用してください。',
        });
    });

    app.post(`${api}/server-update`, attachTenant, (_req, res) => {
        res.status(403).json({
            ok: false,
            error: 'server_update_disabled',
            message: 'git pull / restart.sh は WS-8 のデプロイ手順のみで実行してください。',
        });
    });
}

export default {
    /** @param {import('../../../lib/tenant-plugin-loader.js').PluginRegisterContext} ctx */
    async register(ctx) {
        const allowReload = parseBoolean(ctx.config.allowTenantPluginReload, true);
        if (!allowReload) {
            ctx.logger.warn('admin-reboot: tenant plugin reload disabled by config');
        }
        ctx.logger.info('admin-reboot registered (tenant-safe, no systemctl)');
    },
};