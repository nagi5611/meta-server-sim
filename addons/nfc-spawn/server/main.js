// addons/nfc-spawn/server/main.js — NFC スポーン HTTP API（テナントスコープ）
import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import rateLimit from 'express-rate-limit';
import { HOOKS } from '../../../lib/hook-registry.js';
import { ensureTenantDirectories } from '../../../lib/tenant-storage-paths.js';
import { setNfcSpawnTenantPaths } from '../lib/storage-context.js';
import { isValidWorldId } from '../lib/worlds.js';
import {
    createNfcSpawn,
    deleteNfcSpawn,
    getNfcSpawnById,
    isValidSpawnTokenFormat,
    listNfcSpawns,
    parseSpawnBody,
    recordInstanceBake,
    regenerateSpawnToken,
    resolveInstanceByToken,
    resolveSpawnByToken,
    serializeSpawnRow,
    updateNfcSpawn,
} from '../lib/db.js';
import {
    bakeInstance,
    deleteInstanceFiles,
    getInstanceDir,
    previewInstanceBake,
    spawnRowFromParsedData,
} from '../lib/instance-bake.js';

const JSON_BODY_LIMIT = '32kb';
const SPAWN_ID_RE = /^\d+$/;

const spawnResolveLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: 'rate_limited' },
});

/**
 * ベイク済み静的 GLB 配信用（大量パーツ読込向けに緩め）
 * @param {Record<string, unknown>} config
 */
function createInstanceAssetsLimiter(config) {
    const max =
        typeof config.instanceAssetsRateLimitMax === 'number'
            ? config.instanceAssetsRateLimitMax
            : 10000;
    return rateLimit({
        windowMs: 60 * 1000,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        message: { ok: false, error: 'rate_limited' },
    });
}

/**
 * @param {import('express').Request} req
 * @param {Record<string, unknown>} config
 * @returns {string}
 */
function getPublicOrigin(req, config) {
    const fromConfig =
        typeof config.publicBaseUrl === 'string' ? config.publicBaseUrl.trim().replace(/\/$/, '') : '';
    if (fromConfig) return fromConfig;
    const proto = req.get('x-forwarded-proto') || req.protocol || 'https';
    const host = req.get('x-forwarded-host') || req.get('host') || 'localhost';
    return `${proto}://${host}`;
}

/**
 * @param {import('express').Request} req
 * @param {Record<string, unknown>} config
 * @param {string} token
 * @returns {string}
 */
function buildSpawnUrl(req, config, tenantId, token) {
    const tid = encodeURIComponent(String(tenantId || '').trim());
    return `${getPublicOrigin(req, config)}/${tid}/?spawn=${encodeURIComponent(token)}`;
}

/**
 * @param {import('express').Request} req
 * @param {Record<string, unknown>} config
 * @param {string} token
 * @returns {string}
 */
function buildInstanceUrl(req, config, tenantId, token) {
    const tid = encodeURIComponent(String(tenantId || '').trim());
    return `${getPublicOrigin(req, config)}/${tid}/instance/?token=${encodeURIComponent(token)}`;
}

/**
 * @param {import('express').Request} req
 * @param {Record<string, unknown>} config
 * @param {object} row
 */
function rowWithUrls(req, config, tenantId, row) {
    return serializeSpawnRow(
        row,
        buildSpawnUrl(req, config, tenantId, row.spawn_token),
        buildInstanceUrl(req, config, tenantId, row.spawn_token)
    );
}

/**
 * @param {unknown} body
 * @returns {Set<number>}
 */
function parseExcludeIndices(body) {
    const raw = body?.excludeModelIndices;
    if (!Array.isArray(raw)) return new Set();
    const set = new Set();
    for (const v of raw) {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 0) set.add(n);
    }
    return set;
}

/**
 * @param {unknown} body
 * @returns {Set<string>}
 */
function parseExcludeParts(body) {
    const raw = body?.excludeParts;
    if (!Array.isArray(raw)) return new Set();
    const set = new Set();
    for (const v of raw) {
        const s = String(v).trim();
        if (/^\d+:\d+$/.test(s)) set.add(s);
    }
    return set;
}

/**
 * @param {unknown} body
 * @returns {{ excludeModelIndices: Set<number>, excludeParts: Set<string> }}
 */
function parseBakeExcludes(body) {
    return {
        excludeModelIndices: parseExcludeIndices(body),
        excludeParts: parseExcludeParts(body),
    };
}

/**
 * @param {Record<string, unknown>} config
 */
function getBakeConfig(config) {
    return {
        maxEntries: typeof config.maxBakeEntries === 'number' ? config.maxBakeEntries : 1000,
        maxBytes: typeof config.maxBakeBytes === 'number' ? config.maxBakeBytes : 100 * 1024 * 1024,
        defaultModelRadius:
            typeof config.defaultModelRadius === 'number' ? config.defaultModelRadius : 5,
    };
}

/** @type {Map<string, { ctx: object, jsonMw: import('express').RequestHandler, bakeConfig: object }>} */
const nfcSpawnAdminCtxByTenant = new Map();

/**
 * @param {import('express').Application} app
 * @param {string} base `/admin/tenants/:tenantId`
 * @param {import('express').RequestHandler} attachTenant
 */
export function attachNfcSpawnTenantAdminRoutes(app, base, attachTenant) {
    const api = `${base}/addons/nfc-spawn/spawns`;

    const resolveAdmin = (req, res) => {
        const bundle = nfcSpawnAdminCtxByTenant.get(req.tenant.id);
        if (!bundle) {
            res.status(503).json({ ok: false, error: 'nfc_spawn_plugin_not_loaded' });
            return null;
        }
        return bundle;
    };

    app.get(`${api}`, attachTenant, (req, res) => {
        const bundle = resolveAdmin(req, res);
        if (!bundle) return;
        const { ctx } = bundle;
        try {
            const db = ctx.openDatabase();
            const rows = listNfcSpawns(db);
            res.json({
                ok: true,
                spawns: rows.map((row) => rowWithUrls(req, ctx.config, ctx.tenantId, row)),
            });
        } catch (e) {
            ctx.logger.error('GET admin spawns', e);
            res.status(500).json({ ok: false, error: 'list_failed' });
        }
    });

    app.post(`${api}`, attachTenant, (req, res, next) => {
        const bundle = resolveAdmin(req, res);
        if (!bundle) return;
        return bundle.jsonMw(req, res, next);
    }, (req, res) => {
        const bundle = resolveAdmin(req, res);
        if (!bundle) return;
        const { ctx } = bundle;
        const parsed = parseSpawnBody(req.body);
        if (!parsed.ok) {
            return res.status(400).json({ ok: false, error: parsed.error });
        }
        if (!isValidWorldId(parsed.data.worldId)) {
            return res.status(400).json({ ok: false, error: 'unknown_world' });
        }
        try {
            const db = ctx.openDatabase();
            const row = createNfcSpawn(db, parsed.data);
            res.status(201).json({
                ok: true,
                spawn: rowWithUrls(req, ctx.config, ctx.tenantId, row),
            });
        } catch (e) {
            ctx.logger.error('POST admin spawn', e);
            res.status(500).json({ ok: false, error: 'create_failed' });
        }
    });

    app.post(`${api}/bake-preview`, attachTenant, (req, res, next) => {
        const bundle = resolveAdmin(req, res);
        if (!bundle) return;
        return bundle.jsonMw(req, res, next);
    }, async (req, res) => {
        const bundle = resolveAdmin(req, res);
        if (!bundle) return;
        const { ctx, bakeConfig } = bundle;
        const parsed = parseSpawnBody({ ...req.body, type: 'instance' });
        if (!parsed.ok) {
            return res.status(400).json({ ok: false, error: parsed.error });
        }
        if (!isValidWorldId(parsed.data.worldId)) {
            return res.status(400).json({ ok: false, error: 'unknown_world' });
        }
        try {
            const spawnRow = spawnRowFromParsedData(parsed.data);
            const excludes = parseBakeExcludes(req.body);
            const preview = await previewInstanceBake(spawnRow, excludes, bakeConfig);
            res.json({ ok: true, preview });
        } catch (e) {
            ctx.logger.error('POST bake-preview', e);
            res.status(500).json({ ok: false, error: 'preview_failed' });
        }
    });

    app.post(`${api}/bake`, attachTenant, (req, res, next) => {
        const bundle = resolveAdmin(req, res);
        if (!bundle) return;
        return bundle.jsonMw(req, res, next);
    }, async (req, res) => {
        const bundle = resolveAdmin(req, res);
        if (!bundle) return;
        const { ctx, bakeConfig } = bundle;
        const idRaw = req.body?.id;
        const id = idRaw != null && SPAWN_ID_RE.test(String(idRaw)) ? Number(idRaw) : null;
        const parsed = parseSpawnBody({ ...req.body, type: 'instance' });
        if (!parsed.ok) {
            return res.status(400).json({ ok: false, error: parsed.error });
        }
        if (!isValidWorldId(parsed.data.worldId)) {
            return res.status(400).json({ ok: false, error: 'unknown_world' });
        }
        try {
            const db = ctx.openDatabase();
            let row;
            if (id != null) {
                const existing = getNfcSpawnById(db, id);
                if (!existing) {
                    return res.status(404).json({ ok: false, error: 'not_found' });
                }
                row = updateNfcSpawn(db, id, parsed.data);
            } else {
                row = createNfcSpawn(db, parsed.data);
            }
            if (!row) {
                return res.status(500).json({ ok: false, error: 'save_failed' });
            }
            const excludes = parseBakeExcludes(req.body);
            const bakeResult = await bakeInstance(row, excludes, bakeConfig);
            const updated = recordInstanceBake(db, row.id, bakeResult);
            res.json({
                ok: true,
                bake: {
                    totalBytes: bakeResult.totalBytes,
                    entryCount: bakeResult.entryCount,
                    bakeRevision: bakeResult.bakeRevision,
                },
                spawn: rowWithUrls(req, ctx.config, ctx.tenantId, updated),
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'bake_failed';
            ctx.logger.error('POST bake (upsert)', e);
            const clientErrors = new Set([
                'not_instance_type',
                'no_models_in_sphere',
                'too_many_entries',
                'no_models_baked',
                'bake_too_large',
            ]);
            const code = clientErrors.has(msg) ? msg : 'bake_failed';
            res.status(clientErrors.has(msg) ? 400 : 500).json({ ok: false, error: code });
        }
    });

    app.put(`${api}/:id`, attachTenant, (req, res, next) => {
        const bundle = resolveAdmin(req, res);
        if (!bundle) return;
        return bundle.jsonMw(req, res, next);
    }, (req, res) => {
        const bundle = resolveAdmin(req, res);
        if (!bundle) return;
        const { ctx } = bundle;
        const idStr = String(req.params.id || '');
        if (!SPAWN_ID_RE.test(idStr)) {
            return res.status(400).json({ ok: false, error: 'invalid_id' });
        }
        const id = Number(idStr);
        const parsed = parseSpawnBody(req.body);
        if (!parsed.ok) {
            return res.status(400).json({ ok: false, error: parsed.error });
        }
        if (!isValidWorldId(parsed.data.worldId)) {
            return res.status(400).json({ ok: false, error: 'unknown_world' });
        }
        try {
            const db = ctx.openDatabase();
            const existing = getNfcSpawnById(db, id);
            if (!existing) {
                return res.status(404).json({ ok: false, error: 'not_found' });
            }
            const row = updateNfcSpawn(db, id, parsed.data);
            res.json({
                ok: true,
                spawn: rowWithUrls(req, ctx.config, ctx.tenantId, row),
            });
        } catch (e) {
            ctx.logger.error('PUT admin spawn', e);
            res.status(500).json({ ok: false, error: 'update_failed' });
        }
    });

    app.delete(`${api}/:id`, attachTenant, (req, res) => {
        const bundle = resolveAdmin(req, res);
        if (!bundle) return;
        const { ctx } = bundle;
        const idStr = String(req.params.id || '');
        if (!SPAWN_ID_RE.test(idStr)) {
            return res.status(400).json({ ok: false, error: 'invalid_id' });
        }
        try {
            const db = ctx.openDatabase();
            const id = Number(idStr);
            const ok = deleteNfcSpawn(db, id);
            if (!ok) return res.status(404).json({ ok: false, error: 'not_found' });
            deleteInstanceFiles(id);
            res.json({ ok: true });
        } catch (e) {
            ctx.logger.error('DELETE admin spawn', e);
            res.status(500).json({ ok: false, error: 'delete_failed' });
        }
    });

    app.post(`${api}/:id/regenerate-token`, attachTenant, (req, res) => {
        const bundle = resolveAdmin(req, res);
        if (!bundle) return;
        const { ctx } = bundle;
        const idStr = String(req.params.id || '');
        if (!SPAWN_ID_RE.test(idStr)) {
            return res.status(400).json({ ok: false, error: 'invalid_id' });
        }
        try {
            const db = ctx.openDatabase();
            const row = regenerateSpawnToken(db, Number(idStr));
            if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
            res.json({
                ok: true,
                spawn: rowWithUrls(req, ctx.config, ctx.tenantId, row),
            });
        } catch (e) {
            ctx.logger.error('POST regenerate-token', e);
            res.status(500).json({ ok: false, error: 'regenerate_failed' });
        }
    });

    app.get(`${api}/:id/bake-preview`, attachTenant, async (req, res) => {
        const bundle = resolveAdmin(req, res);
        if (!bundle) return;
        const { ctx, bakeConfig } = bundle;
        const idStr = String(req.params.id || '');
        if (!SPAWN_ID_RE.test(idStr)) {
            return res.status(400).json({ ok: false, error: 'invalid_id' });
        }
        try {
            const db = ctx.openDatabase();
            const row = getNfcSpawnById(db, Number(idStr));
            if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
            if (String(row.type || '') !== 'instance') {
                return res.status(400).json({ ok: false, error: 'not_instance_type' });
            }
            const excludeRaw = req.query.exclude;
            const excludes = parseBakeExcludes({
                excludeModelIndices:
                    typeof excludeRaw === 'string' && excludeRaw.trim()
                        ? excludeRaw.split(',').map((p) => Number(p.trim()))
                        : [],
            });
            const preview = await previewInstanceBake(row, excludes, bakeConfig);
            res.json({ ok: true, preview });
        } catch (e) {
            ctx.logger.error('GET bake-preview', e);
            res.status(500).json({ ok: false, error: 'preview_failed' });
        }
    });

    app.post(`${api}/:id/bake`, attachTenant, (req, res, next) => {
        const bundle = resolveAdmin(req, res);
        if (!bundle) return;
        return bundle.jsonMw(req, res, next);
    }, async (req, res) => {
        const bundle = resolveAdmin(req, res);
        if (!bundle) return;
        const { ctx, bakeConfig } = bundle;
        const idStr = String(req.params.id || '');
        if (!SPAWN_ID_RE.test(idStr)) {
            return res.status(400).json({ ok: false, error: 'invalid_id' });
        }
        try {
            const db = ctx.openDatabase();
            const row = getNfcSpawnById(db, Number(idStr));
            if (!row) return res.status(404).json({ ok: false, error: 'not_found' });
            if (String(row.type || '') !== 'instance') {
                return res.status(400).json({ ok: false, error: 'not_instance_type' });
            }
            const excludes = parseBakeExcludes(req.body);
            const bakeResult = await bakeInstance(row, excludes, bakeConfig);
            const updated = recordInstanceBake(db, row.id, bakeResult);
            res.json({
                ok: true,
                bake: {
                    totalBytes: bakeResult.totalBytes,
                    entryCount: bakeResult.entryCount,
                    bakeRevision: bakeResult.bakeRevision,
                },
                spawn: rowWithUrls(req, ctx.config, ctx.tenantId, updated),
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'bake_failed';
            ctx.logger.error('POST bake', e);
            const clientErrors = new Set([
                'not_instance_type',
                'no_models_in_sphere',
                'too_many_entries',
                'no_models_baked',
                'bake_too_large',
            ]);
            const code = clientErrors.has(msg) ? msg : 'bake_failed';
            res.status(clientErrors.has(msg) ? 400 : 500).json({ ok: false, error: code });
        }
    });
}

export default {
    /**
     * @param {import('../../../lib/tenant-plugin-loader.js').PluginRegisterContext} ctx
     */
    async register(ctx) {
        setNfcSpawnTenantPaths(ctx.tenant.paths);
        ensureTenantDirectories(ctx.tenant.paths);

        const jsonMw = express.json({ limit: JSON_BODY_LIMIT });
        const bakeConfig = getBakeConfig(ctx.config);
        const instanceAssetsLimiter = createInstanceAssetsLimiter(ctx.config);
        nfcSpawnAdminCtxByTenant.set(ctx.tenantId, { ctx, jsonMw, bakeConfig });

        const instanceHtml = path.join(ctx.paths.addonRoot, 'static', 'instance', 'index.html');
        const httpBase = ctx.paths.httpBasePath;

        let publicRouter = null;
        ctx.mountHttp((router) => {
            publicRouter = router;
            router.get('/spawn/:token', spawnResolveLimiter, (req, res) => {
                const token = String(req.params.token || '').trim();
                if (!isValidSpawnTokenFormat(token)) {
                    return res.status(400).json({ ok: false, error: 'invalid_token' });
                }
                try {
                    const db = ctx.openDatabase();
                    const resolved = resolveSpawnByToken(db, token);
                    if (!resolved) {
                        return res.status(404).json({ ok: false, error: 'not_found' });
                    }
                    if (!resolved.enabled) {
                        return res.status(403).json({ ok: false, error: 'disabled' });
                    }
                    if (!isValidWorldId(resolved.worldId)) {
                        return res.status(410).json({ ok: false, error: 'world_missing' });
                    }
                    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
                    res.json({
                        ok: true,
                        world: resolved.worldId,
                        position: resolved.position,
                        yaw: resolved.yaw,
                        label: resolved.label,
                    });
                } catch (e) {
                    ctx.logger.error('GET spawn', e);
                    res.status(500).json({ ok: false, error: 'resolve_failed' });
                }
            });

            router.get('/instance/:token', spawnResolveLimiter, (req, res) => {
                const token = String(req.params.token || '').trim();
                if (!isValidSpawnTokenFormat(token)) {
                    return res.status(400).json({ ok: false, error: 'invalid_token' });
                }
                try {
                    const db = ctx.openDatabase();
                    const resolved = resolveInstanceByToken(db, token);
                    if (!resolved) {
                        return res.status(404).json({ ok: false, error: 'not_found' });
                    }
                    if (!resolved.enabled) {
                        return res.status(403).json({ ok: false, error: 'disabled' });
                    }
                    const manifestUrl = `/${encodeURIComponent(ctx.tenantId)}${httpBase}/instance-assets/${resolved.id}/manifest.json`;
                    res.setHeader('Cache-Control', 'private, no-store, max-age=0');
                    res.json({
                        ok: true,
                        label: resolved.label,
                        spawnId: resolved.id,
                        manifestUrl,
                        bakeRevision: resolved.bakeRevision,
                    });
                } catch (e) {
                    ctx.logger.error('GET instance', e);
                    res.status(500).json({ ok: false, error: 'resolve_failed' });
                }
            });

            router.get('/instance-assets/:spawnId/*', instanceAssetsLimiter, (req, res) => {
                const spawnIdStr = String(req.params.spawnId || '');
                if (!SPAWN_ID_RE.test(spawnIdStr)) {
                    return res.status(400).json({ ok: false, error: 'invalid_id' });
                }
                const rel = String(req.params[0] || '').replace(/\\/g, '/');
                if (!rel || rel.includes('..')) {
                    return res.status(400).json({ ok: false, error: 'invalid_path' });
                }
                const abs = path.resolve(path.join(getInstanceDir(Number(spawnIdStr)), rel));
                const assetBase = path.resolve(getInstanceDir(Number(spawnIdStr)));
                if (abs !== assetBase && !abs.startsWith(assetBase + path.sep)) {
                    return res.status(403).json({ ok: false, error: 'forbidden' });
                }
                if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
                    return res.status(404).json({ ok: false, error: 'not_found' });
                }
                if (rel.endsWith('.json')) {
                    res.type('application/json');
                } else if (rel.endsWith('.glb')) {
                    res.type('model/gltf-binary');
                }
                res.setHeader('Cache-Control', 'public, max-age=3600');
                res.sendFile(abs);
            });
        });

        ctx.hooks.on(HOOKS.AFTER_TENANT_ROUTES_MOUNTED, (payload) => {
            if (payload.tenantId !== ctx.tenantId || !publicRouter) return;
            payload.tenantRouter.use('/api/addons/nfc-spawn', publicRouter);
            payload.tenantRouter.get('/instance', (_req, res) => {
                if (!fs.existsSync(instanceHtml)) {
                    return res.status(404).send('instance viewer not found');
                }
                res.sendFile(instanceHtml);
            });
            payload.tenantRouter.get('/instance/', (_req, res) => {
                if (!fs.existsSync(instanceHtml)) {
                    return res.status(404).send('instance viewer not found');
                }
                res.sendFile(instanceHtml);
            });
        });

        ctx.logger.info('registered');
    },
};
