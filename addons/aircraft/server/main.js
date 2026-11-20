// addons/aircraft/server/main.js — テナント飛行機プラグイン（Socket + 機体タグ DB）
import express from 'express';
import { HOOKS } from '../../../lib/hook-registry.js';
import { readTenantWorlds } from '../../../lib/tenant-api.js';
import { getTenantRoomState } from '../../../lib/tenant-socket.js';
import { registerAircraftSocketHandlers } from '../../../lib/aircraft-server/register-socket.js';
import { setAircraftServerDepsForTenant } from '../../../lib/aircraft-server/deps-registry.js';
import { buildAircraftSnapshotList } from '../../../lib/aircraft-server/room-aircraft.js';
import { mergeAircraftPhysicsFromWorld } from '../client/aircraft-physics-defaults.js';
import {
    mergeEasyAircraftPhysicsFromWorld,
    normalizeAircraftControlMode,
} from '../client/aircraft-physics-easy-defaults.js';
import { seedDefaultAirframes } from './seed-presets.js';

const AIRFRAME_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const JSON_BODY_LIMIT = 512 * 1024;

/** @type {Map<string, object>} */
const aircraftCtxByTenant = new Map();

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 */
function rowToAirframe(db, id) {
    const row = db.prepare('SELECT * FROM aircraft_airframe WHERE id = ?').get(id);
    if (!row) return null;
  const controlMode = normalizeAircraftControlMode(row.control_mode);
    let physicsHard = {};
    let physicsEasy = {};
    let cameraHard = {};
    let cameraEasy = {};
    try {
        physicsHard = row.physics_json ? JSON.parse(String(row.physics_json)) : {};
    } catch {
        physicsHard = {};
    }
    try {
        physicsEasy = row.physics_easy_json ? JSON.parse(String(row.physics_easy_json)) : {};
    } catch {
        physicsEasy = {};
    }
    try {
        cameraHard = row.camera_json ? JSON.parse(String(row.camera_json)) : {};
    } catch {
        cameraHard = {};
    }
    try {
        cameraEasy = row.camera_easy_json ? JSON.parse(String(row.camera_easy_json)) : {};
    } catch {
        cameraEasy = {};
    }
    const flightPhysicsHard = mergeAircraftPhysicsFromWorld(physicsHard);
    const flightPhysicsEasy = mergeEasyAircraftPhysicsFromWorld(physicsEasy);
    const activePhysics = controlMode === 'easy' ? flightPhysicsEasy : flightPhysicsHard;
    const activeCamera = controlMode === 'easy' ? cameraEasy : cameraHard;
    return {
        id: String(row.id),
        displayName: String(row.display_name || ''),
        prefabManifest: String(row.prefab_manifest || ''),
        controlMode,
        bindings: {},
        animation: {},
        flightPhysicsHard,
        flightPhysicsEasy,
        cameraHard,
        cameraEasy,
        flightPhysics: activePhysics,
        camera: activeCamera,
        updatedAt: String(row.updated_at || ''),
    };
}

/**
 * @param {import('express').Router} router
 * @param {object} ctx
 */
function attachAircraftPublicRoutes(router, ctx) {
    const airframeIdParam = (req, res, next) => {
        const id = String(req.params?.id || '').trim();
        if (!AIRFRAME_ID_RE.test(id)) {
            return res.status(400).json({ error: 'invalid_airframe_id' });
        }
        res.locals.airframeId = id;
        next();
    };

    router.get('/lookup-airframe-id-by-prefab-manifest', (req, res) => {
        const man =
            typeof req.query.prefabManifest === 'string'
                ? req.query.prefabManifest.trim().slice(0, 1024)
                : '';
        if (!man) return res.status(400).json({ error: 'missing_prefab_manifest' });
        const db = ctx.openDatabase();
        const row = db
            .prepare('SELECT id FROM aircraft_airframe WHERE prefab_manifest = ? LIMIT 1')
            .get(man);
        if (!row) return res.status(404).json({ error: 'not_found' });
        res.json({ ok: true, airframeId: String(row.id) });
    });

    router.get('/airframes/:id', airframeIdParam, (req, res) => {
        const db = ctx.openDatabase();
        const row = rowToAirframe(db, res.locals.airframeId);
        if (!row) return res.status(404).json({ error: 'not_found' });
        res.setHeader('Cache-Control', 'public, max-age=60');
        res.json({ ok: true, airframe: row });
    });
}

/**
 * @param {import('express').Application} app
 * @param {string} base
 * @param {import('express').RequestHandler} attachTenant
 */
export function attachAircraftTenantAdminRoutes(app, base, attachTenant) {
    const jsonMw = express.json({ limit: JSON_BODY_LIMIT });
    const airframeIdParam = (req, res, next) => {
        const id = String(req.params?.id || '').trim();
        if (!AIRFRAME_ID_RE.test(id)) return res.status(400).json({ error: 'invalid_airframe_id' });
        res.locals.airframeId = id;
        next();
    };

    app.get(`${base}/addons/aircraft/airframes`, attachTenant, (req, res) => {
        const ctx = aircraftCtxByTenant.get(req.tenant.id);
        if (!ctx) return res.json({ ok: true, airframes: [] });
        const db = ctx.openDatabase();
        const rows = db
            .prepare(
                'SELECT id, display_name, prefab_manifest, control_mode, updated_at FROM aircraft_airframe ORDER BY id ASC'
            )
            .all();
        res.json({
            ok: true,
            airframes: rows.map((r) => ({
                id: String(r.id),
                displayName: String(r.display_name || ''),
                prefabManifest: String(r.prefab_manifest || ''),
                controlMode: normalizeAircraftControlMode(r.control_mode),
                updatedAt: String(r.updated_at || ''),
            })),
        });
    });

    app.get(`${base}/addons/aircraft/airframes/:id`, attachTenant, airframeIdParam, (req, res) => {
        const ctx = aircraftCtxByTenant.get(req.tenant.id);
        if (!ctx) return res.status(404).json({ error: 'not_found' });
        const row = rowToAirframe(ctx.openDatabase(), res.locals.airframeId);
        if (!row) return res.status(404).json({ error: 'not_found' });
        res.json({ ok: true, airframe: row });
    });

    app.put(`${base}/addons/aircraft/airframes/:id`, attachTenant, airframeIdParam, jsonMw, (req, res) => {
        const ctx = aircraftCtxByTenant.get(req.tenant.id);
        if (!ctx) return res.status(503).json({ error: 'plugin_disabled' });
        const db = ctx.openDatabase();
        const id = res.locals.airframeId;
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        const displayName = typeof body.displayName === 'string' ? body.displayName.trim().slice(0, 200) : '';
        const controlMode = normalizeAircraftControlMode(body.controlMode);
        const fpHard = mergeAircraftPhysicsFromWorld(body.flightPhysicsHard ?? body.flightPhysics ?? {});
        const fpEasy = mergeEasyAircraftPhysicsFromWorld(body.flightPhysicsEasy ?? {});
        const cameraHard = body.cameraHard ?? body.camera ?? {};
        const cameraEasy = body.cameraEasy ?? {};
        const exists = db.prepare('SELECT 1 FROM aircraft_airframe WHERE id = ?').get(id);
        if (exists) {
            db.prepare(
                `UPDATE aircraft_airframe SET display_name=?, physics_json=?, camera_json=?, control_mode=?, physics_easy_json=?, camera_easy_json=?, updated_at=datetime('now') WHERE id=?`
            ).run(
                displayName,
                JSON.stringify(fpHard),
                JSON.stringify(cameraHard),
                controlMode,
                JSON.stringify(fpEasy),
                JSON.stringify(cameraEasy),
                id
            );
        } else {
            db.prepare(
                `INSERT INTO aircraft_airframe (id, display_name, prefab_manifest, bindings_json, animation_json, physics_json, camera_json, control_mode, physics_easy_json, camera_easy_json)
                 VALUES (?, ?, '', '{}', '{}', ?, ?, ?, ?, ?)`
            ).run(
                id,
                displayName,
                JSON.stringify(fpHard),
                JSON.stringify(cameraHard),
                controlMode,
                JSON.stringify(fpEasy),
                JSON.stringify(cameraEasy)
            );
        }
        res.json({ ok: true, airframe: rowToAirframe(db, id) });
    });

    app.delete(`${base}/addons/aircraft/airframes/:id`, attachTenant, airframeIdParam, (req, res) => {
        const ctx = aircraftCtxByTenant.get(req.tenant.id);
        if (!ctx) return res.status(503).json({ error: 'plugin_disabled' });
        const r = ctx.openDatabase().prepare('DELETE FROM aircraft_airframe WHERE id = ?').run(res.locals.airframeId);
        if (r.changes === 0) return res.status(404).json({ error: 'not_found' });
        res.json({ ok: true });
    });
}

export function getAircraftPluginCtx(tenantId) {
    return aircraftCtxByTenant.get(tenantId) || null;
}

export default {
    /**
     * @param {import('../../../lib/tenant-plugin-loader.js').PluginRegisterContext} ctx
     */
    async register(ctx) {
        const db = ctx.openDatabase();
        seedDefaultAirframes(db);
        db.prepare(
            `UPDATE aircraft_airframe SET prefab_manifest = 'sim/builtin-aircraft'
             WHERE prefab_manifest IS NULL OR TRIM(prefab_manifest) = ''`
        ).run();
        setAircraftServerDepsForTenant(ctx.tenantId, {
            getRoomState: (roomId) => getTenantRoomState(ctx.tenantId, roomId),
            readWorlds: () => readTenantWorlds(ctx.tenant),
        });
        aircraftCtxByTenant.set(ctx.tenantId, ctx);
        const io = ctx.getIo();
        if (io) registerAircraftSocketHandlers(io);

        let publicRouter = null;
        ctx.mountHttp((router) => {
            publicRouter = router;
            attachAircraftPublicRoutes(router, ctx);
        });

        ctx.hooks.on(HOOKS.AFTER_TENANT_ROUTES_MOUNTED, (payload) => {
            if (payload.tenantId !== ctx.tenantId || !publicRouter) return;
            payload.tenantRouter.use('/api/addons/aircraft', publicRouter);
        });

        ctx.hooks.on(HOOKS.SOCKET_TENANT_CONNECT, ({ socket, tenantId }) => {
            if (tenantId !== ctx.tenantId) return;
            const rid = socket.data?.currentRoom;
            if (!rid) return;
            socket.emit('aircraft-initial', {
                aircraft: buildAircraftSnapshotList(getTenantRoomState(ctx.tenantId, rid)),
            });
        });

        ctx.logger.info('registered');
    },
};