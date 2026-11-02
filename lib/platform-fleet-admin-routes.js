// lib/platform-fleet-admin-routes.js — /admin/fleet/* （Basic 認証下）
import {
    controlFleetService,
    fleetGetEnv,
    fleetSetEnv,
    getFleetOpsMeta,
    getFleetServiceStatus,
    isFleetOpsEnabled,
} from './platform-fleet-ops.js';

/**
 * @param {import('express').Express} app
 * @param {{ basicAuth: import('express').RequestHandler, adminRateLimit: import('express').RequestHandler }} guards
 */
export function registerPlatformFleetAdminRoutes(app, guards) {
    const { basicAuth, adminRateLimit } = guards;
    const stack = [adminRateLimit, basicAuth];

    app.get('/admin/fleet', stack, (_req, res) => {
        if (!isFleetOpsEnabled()) {
            return res.status(503).json({
                enabled: false,
                error: 'fleet_ops_disabled',
                message: 'PLATFORM_FLEET_OPS_ENABLED=0 または fleet-registry が空です',
            });
        }
        return res.json(getFleetOpsMeta());
    });

    app.get('/admin/fleet/cores/:coreId/status', stack, async (req, res) => {
        try {
            const data = await getFleetServiceStatus(req.params.coreId);
            return res.json({ ok: true, ...data });
        } catch (e) {
            return res.status(400).json({
                ok: false,
                message: e instanceof Error ? e.message : 'status failed',
            });
        }
    });

    app.post('/admin/fleet/cores/:coreId/service', stack, async (req, res) => {
        const action = String(req.body?.action ?? '').trim();
        if (!['start', 'stop', 'restart'].includes(action)) {
            return res.status(400).json({ ok: false, message: 'action must be start|stop|restart' });
        }
        try {
            const data = await controlFleetService(req.params.coreId, /** @type {'start'|'stop'|'restart'} */ (action));
            return res.json({ ok: true, ...data });
        } catch (e) {
            return res.status(500).json({
                ok: false,
                message: e instanceof Error ? e.message : 'service control failed',
            });
        }
    });

    app.get('/admin/fleet/cores/:coreId/env', stack, async (req, res) => {
        try {
            const data = await fleetGetEnv(req.params.coreId);
            return res.json({ ok: true, ...data });
        } catch (e) {
            return res.status(400).json({
                ok: false,
                message: e instanceof Error ? e.message : 'env read failed',
            });
        }
    });

    app.put('/admin/fleet/cores/:coreId/env', stack, async (req, res) => {
        const updates = req.body?.updates;
        if (!updates || typeof updates !== 'object') {
            return res.status(400).json({ ok: false, message: 'updates object required' });
        }
        try {
            const data = await fleetSetEnv(req.params.coreId, updates);
            return res.json({ ok: true, ...data });
        } catch (e) {
            return res.status(400).json({
                ok: false,
                message: e instanceof Error ? e.message : 'env write failed',
            });
        }
    });
}
