// lib/tenant-api.js

import fs from 'node:fs';

import express from 'express';

import path from 'node:path';

import { tenantErrorBoundary } from './tenant-error.js';

import { getPortalLinksForRequest } from './platform-network-config.js';

import { isPathInsideTenantRoot } from './tenant-storage-paths.js';
import { getClientStorageConfig, isR2Enabled } from './r2/storage-backend.js';
import {
    createR2StaticHandler,
    isR2StorageActive,
    signAssetPaths,
} from './r2/tenant-r2-delivery.js';
import { tenantAssetExists } from './tenant-r2-sync.js';
import { createFdsSmokeStaticHandler } from './fds-smoke-delivery.js';
import {
    getFdsSmokeBulkPort,
    resolveFdsSmokeBulkPublicOrigin,
} from './fds-smoke-bulk-process.js';
import { getPlannedRestartPublicState } from './platform-planned-restart.js';
import {
    ensureGuestHttpAuthForClientConfig,
    isTenantMetaverseHttpAuthorized,
} from './tenant-metaverse-http-auth.js';
import { createTenantPublicApiRateLimit } from './http-rate-limit.js';
import { tenantSecurityHeadersMiddleware } from './tenant-security-headers.js';
import { attachTenantPluginHttpDispatcher } from './tenant-plugin-http-registry.js';
import {
    getLegacyAddonsEnabledMap,
    getPublicTenantAddonsEnabled,
    registerTenantPluginLazyMiddleware,
} from './tenant-plugin-runtime.js';
import { findPluginForTenant } from './tenant-plugin-catalog.js';
import { isTenantPluginEnabled } from '../db/tenant-plugins-registry.js';
import { registerTenantUserAuthRoutes } from './tenant-user-auth-routes.js';
import {
    avatarPublicGlbPath,
    ensureAvatarRegistry,
    findAvatarById,
    getTenantAvatarsDir,
    hasCompleteAnimationMap,
    resolveAvatarId,
} from './tenant-avatar-registry.js';



const DEFAULT_ROOM = 'lobby';



/**

 * tenant 配下の静的ファイルを配信するミドルウェア

 * @param {import('./tenant-registry.js').TenantRecord} tenant

 * @param {string} baseDir

 * @param {string} urlPrefix 例: '/models'

 */

function createTenantStaticHandler(tenant, baseDir, urlPrefix) {

    return tenantErrorBoundary((req, res, next) => {

        const rel = req.path.replace(/^\/+/, '');

        if (rel.includes('..')) {

            return res.status(403).json({ error: 'forbidden_path' });

        }

        const filePath = path.join(baseDir, rel);

        if (!isPathInsideTenantRoot(tenant.paths.TENANT_ROOT, filePath)) {

            return res.status(403).json({ error: 'forbidden_path' });

        }

        if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {

            return res.status(404).end();

        }

        res.sendFile(filePath);

    });

}



/**

 * テナント静的配信ハンドラを作成する（ローカル / R2）

 * @param {import('./tenant-registry.js').TenantRecord} tenant

 * @param {string} baseDir

 * @param {string} store

 */

function createTenantAssetHandler(tenant, baseDir, store) {

    if (isR2StorageActive()) {

        return tenantErrorBoundary(createR2StaticHandler(tenant, store));

    }

    const urlPrefix = `/${store}`;

    return createTenantStaticHandler(tenant, baseDir, urlPrefix);

}



/**

 * tenant 配下の worlds.json を読む

 * @param {import('./tenant-registry.js').TenantRecord} tenant

 * @returns {Record<string, unknown> | null}

 */

export function readTenantWorlds(tenant) {

    const worldsPath = tenant.paths.WORLDS_PATH;

    if (!fs.existsSync(worldsPath)) return null;

    try {

        const raw = fs.readFileSync(worldsPath, 'utf8');

        const data = JSON.parse(raw);

        if (data && typeof data === 'object') return data;

        return null;

    } catch (e) {

        console.error(`[tenant:${tenant.id}] read worlds failed:`, e);

        return null;

    }

}



/**

 * tenant 用 Express ルーター（req.tenant 必須）

 * @param {string} staticDir

 * @returns {import('express').Router}

 */

export function createTenantRouter(staticDir) {

    const router = express.Router();

    attachTenantPluginHttpDispatcher(router);
    registerTenantPluginLazyMiddleware(router);
    registerTenantUserAuthRoutes(router);

    router.use(tenantSecurityHeadersMiddleware);

    const tenantPublicApiRateLimit = createTenantPublicApiRateLimit();
    router.use((req, res, next) => {
        const p = String(req.path || '');
        if (!p.startsWith('/api') && p !== '/api') return next();
        return tenantPublicApiRateLimit(req, res, next);
    });



    router.get(

        '/api/health',

        tenantErrorBoundary((_req, res) => {

            res.json({

                ok: true,

                tenantId: _req.tenant.id,

                service: 'metaverse-simulation-tenant',

            });

        })

    );



    router.get(

        '/api/worlds',

        tenantErrorBoundary((req, res) => {

            const worlds = readTenantWorlds(req.tenant);

            if (!worlds) {

                return res.status(500).json({ error: 'worlds_unavailable', tenantId: req.tenant.id });

            }

            // metaverse-simple クライアント互換: ワールド定義をそのまま返す

            res.json(worlds);

        })

    );



    router.get(

        '/api/client-config',

        tenantErrorBoundary((req, res) => {

            res.setHeader('Cache-Control', 'private, no-store, max-age=0');

            const tenantId = req.tenant.id;

            const storageCfg = getClientStorageConfig(tenantId);
            const bulkPort = getFdsSmokeBulkPort();
            const bulkOrigin = resolveFdsSmokeBulkPublicOrigin(req, bulkPort);

            const httpAuthToken = ensureGuestHttpAuthForClientConfig(req, res);

            res.json({

                service: 'metaverse-simulation-tenant',

                tenantId,

                socketPath: `/${tenantId}/socket.io`,

                defaultRoom: DEFAULT_ROOM,

                portalLinks: getPortalLinksForRequest(req),

                chartFeaturesEnabled: false,

                storageBackend: storageCfg.storageBackend,

                assetModels: storageCfg.assetModels,

                worldLoadConcurrency: 24,

                httpAuthToken: httpAuthToken || null,

                fdsSmokeBulk: bulkOrigin
                    ? { enabled: true, origin: bulkOrigin }
                    : { enabled: false },

                plannedRestart: getPlannedRestartPublicState(),

            });

        })

    );



    router.get(

        '/api/addons/enabled',

        tenantErrorBoundary((req, res) => {

            res.setHeader('Cache-Control', 'private, no-store, max-age=0');

            res.json(getLegacyAddonsEnabledMap(req.tenant));

        })

    );

    router.get(
        '/api/tenants/:tenantIdParam/addons/enabled',
        tenantErrorBoundary((req, res) => {
            const param = String(req.params.tenantIdParam || '').trim();
            if (param !== req.tenant.id) {
                return res.status(404).json({ error: 'tenant_mismatch' });
            }
            res.setHeader('Cache-Control', 'private, no-store, max-age=0');
            return res.json(getPublicTenantAddonsEnabled(req.tenant));
        })
    );

    router.get(
        '/addons-client/:pluginId/*',
        tenantErrorBoundary((req, res) => {
            const pluginId = String(req.params.pluginId || '').trim();
            const rel = String(req.params[0] || '').replace(/^\/+/, '');
            if (!pluginId || !rel || rel.includes('..')) {
                return res.status(400).json({ error: 'bad_request' });
            }
            const discovered = findPluginForTenant(req.tenant, pluginId);
            if (!discovered || !isTenantPluginEnabled(req.tenant.id, pluginId)) {
                return res.status(404).json({ error: 'not_found' });
            }
            const filePath = path.join(discovered.addonRoot, rel);
            if (!isPathInsideTenantRoot(discovered.addonRoot, filePath)) {
                return res.status(403).json({ error: 'forbidden_path' });
            }
            if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
                return res.status(404).json({ error: 'not_found' });
            }
            res.type(path.extname(filePath));
            return res.sendFile(filePath);
        })
    );



    router.post(

        '/api/sign-asset-urls',

        tenantErrorBoundary(async (req, res) => {

            if (!isR2Enabled()) {

                return res.status(503).json({ error: 'signing_unavailable' });

            }

            if (!isTenantMetaverseHttpAuthorized(req)) {

                return res.status(401).json({ error: 'unauthorized' });

            }

            const pathsIn = req.body?.paths ?? req.body?.urls;

            if (!Array.isArray(pathsIn) || pathsIn.length === 0) {

                return res.status(400).json({ error: 'paths array required' });

            }

            const max = Math.min(pathsIn.length, 64);

            const paths = pathsIn.slice(0, max).map((p) => String(p || '').trim()).filter(Boolean);

            const signed = await signAssetPaths(req.tenant.id, paths);

            res.json({ signed });

        })

    );



    router.get(

        '/api/active-avatar',

        tenantErrorBoundary(async (req, res) => {

            res.setHeader('Cache-Control', 'private, no-store, max-age=0');

            const reg = await ensureAvatarRegistry(req.tenant);
            const avatarsDir = getTenantAvatarsDir(req.tenant.paths.TENANT_ROOT);
            const avatarId = resolveAvatarId(reg, avatarsDir, null);
            if (avatarId) {
                const entry = findAvatarById(reg, avatarId);
                const glbPath = avatarPublicGlbPath(entry, req.tenant.id);
                if (glbPath) {
                    const body = {
                        path: glbPath,
                        glbPath,
                        animationMap: entry.animationMap,
                        animationClips: entry.animationClips,
                        displayScale: entry.displayScale ?? 1,
                    };
                    if (isR2StorageActive()) {
                        const signed = await signAssetPaths(req.tenant.id, [glbPath]);
                        body.signedUrl = signed[glbPath] || null;
                    }
                    return res.json(body);
                }
            }

            if (isR2StorageActive()) {

                const present = await tenantAssetExists(req.tenant, 'models', 'avatar.glb');

                return res.json({ path: present ? 'models/avatar.glb' : null });

            }

            const avatarPath = path.join(req.tenant.paths.MODELS_DIR, 'avatar.glb');

            if (!fs.existsSync(avatarPath)) {

                return res.json({ path: null });

            }

            res.json({ path: 'models/avatar.glb' });

        })

    );



    router.get(

        '/api/env-ibl-hdr',

        tenantErrorBoundary(async (req, res) => {

            res.setHeader('Cache-Control', 'private, no-store, max-age=0');

            if (isR2StorageActive()) {

                const present = await tenantAssetExists(req.tenant, 'env', 'default.hdr');

                return res.json({

                    path: 'env/default.hdr',

                    present,

                });

            }

            const destPath = path.join(req.tenant.paths.ENV_DIR, 'default.hdr');

            res.json({

                path: 'env/default.hdr',

                present: fs.existsSync(destPath),

            });

        })

    );



    router.get(

        '/api/avatars',

        tenantErrorBoundary(async (req, res) => {

            res.setHeader('Cache-Control', 'private, no-store, max-age=0');

            const reg = await ensureAvatarRegistry(req.tenant);
            /** @type {object[]} */
            const avatars = [];
            for (const a of reg.avatars || []) {
                if (!hasCompleteAnimationMap(a)) continue;
                const glbPath = avatarPublicGlbPath(a, req.tenant.id);
                if (!glbPath) continue;
                const item = {
                    id: a.id,
                    path: glbPath,
                    glbPath,
                    animationMap: a.animationMap,
                    isDefault: !!a.isDefault,
                    displayScale: a.displayScale ?? 1,
                };
                if (isR2StorageActive()) {
                    const signed = await signAssetPaths(req.tenant.id, [glbPath]);
                    item.signedUrl = signed[glbPath] || null;
                }
                avatars.push(item);
            }
            res.json({ avatars });

        })

    );



    router.get(

        '/api/avatar/:avatarId',

        tenantErrorBoundary(async (req, res) => {

            res.setHeader('Cache-Control', 'private, no-store, max-age=0');

            const reg = await ensureAvatarRegistry(req.tenant);
            const entry = findAvatarById(reg, req.params.avatarId);
            if (!entry || !hasCompleteAnimationMap(entry)) {
                return res.status(404).json({ error: 'avatar_not_found' });
            }
            const glbPath = avatarPublicGlbPath(entry, req.tenant.id);
            if (!glbPath) return res.status(404).json({ error: 'avatar_not_found' });

            const body = {
                id: entry.id,
                path: glbPath,
                glbPath,
                animationMap: entry.animationMap,
                animationClips: entry.animationClips,
                displayScale: entry.displayScale ?? 1,
                isDefault: !!entry.isDefault,
            };
            if (isR2StorageActive()) {
                const signed = await signAssetPaths(req.tenant.id, [glbPath]);
                body.signedUrl = signed[glbPath] || null;
            }
            res.json(body);

        })

    );



    router.use('/models', (req, res, next) => {

        const tenant = req.tenant;

        createTenantAssetHandler(tenant, tenant.paths.MODELS_DIR, 'models')(req, res, next);

    });



    router.use('/avatars', (req, res, next) => {

        const tenant = req.tenant;

        const avatarsDir = getTenantAvatarsDir(tenant.paths.TENANT_ROOT);

        if (isR2StorageActive()) {

            return createTenantAssetHandler(tenant, avatarsDir, 'avatars')(req, res, next);

        }

        createTenantStaticHandler(tenant, avatarsDir, '/avatars')(req, res, next);

    });



    router.use('/images', (req, res, next) => {

        const tenant = req.tenant;

        createTenantAssetHandler(tenant, tenant.paths.IMAGES_DIR, 'images')(req, res, next);

    });



    router.use('/pdfs', (req, res, next) => {

        const tenant = req.tenant;

        createTenantAssetHandler(tenant, tenant.paths.PDFS_DIR, 'pdfs')(req, res, next);

    });



    router.use('/env', (req, res, next) => {

        const tenant = req.tenant;

        createTenantAssetHandler(tenant, tenant.paths.ENV_DIR, 'env')(req, res, next);

    });



    router.use('/simulations', (req, res, next) => {

        const tenant = req.tenant;

        createFdsSmokeStaticHandler(tenant)(req, res, next);

    });



    router.get('/', (_req, res) => {

        res.sendFile(path.join(staticDir, 'tenant.html'));

    });



    return router;

}

