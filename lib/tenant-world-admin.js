// lib/tenant-world-admin.js — Tenant 別ワールド編集 API（metaverse-simple /admin 互換）
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { getTenant } from './tenant-registry.js';
import { readTenantWorlds } from './tenant-api.js';
import { isPathInsideTenantRoot } from './tenant-storage-paths.js';
import { getPortalLinksForRequest } from './platform-network-config.js';
import {
    validateWorldsFloorDimensions,
    validateWorldsPhysicsAssist,
    validateWorldsPlayBoundsAndColliders,
} from './tenant-worlds-validate.js';
import { normalizeWorldsLod } from '../../metaverse-simple/public/js/world-lod-normalize.js';
import { normalizeWorldsRod } from '../../metaverse-simple/public/js/world-rod-resolve.js';
import {
    deleteFdsSmokeSimulation,
    extractFdsSmokeZip,
    FDS_SMOKE_MAX_ZIP_BYTES,
    FdsSmokeUploadError,
    isValidSimId,
    listSimulations,
    saveFdsSmokeSimulation,
    simIdFromZipFilename,
} from './fds-smoke-upload.js';
import { getClientStorageConfig, isR2Enabled } from './r2/storage-backend.js';
import {
    handleR2StorageFilesBulkDelete,
    handleR2StorageFilesList,
    registerTenantR2AdminRoutes,
} from './r2/tenant-r2-admin-routes.js';
import { listMergedTenantStoreFilenames } from './tenant-r2-sync.js';
import {
    getTenantModelUploadQueueStats,
    saveTenantModelUpload,
} from './tenant-model-upload.js';

const TENANT_ADMIN_UPLOAD_MAX_BYTES = 150 * 1024 * 1024;
/** multer 受信〜ハンドラ完了までの同時数（大容量をメモリに溜めない） */
const TENANT_ADMIN_UPLOAD_MAX_CONCURRENCY = 3;
const TENANT_ADMIN_UPLOAD_TMP_DIR = path.join(os.tmpdir(), 'metaverse-tenant-admin-uploads');

let activeTenantAdminMulterInFlight = 0;

const upload = multer({
    storage: multer.diskStorage({
        destination(_req, _file, cb) {
            fs.mkdirSync(TENANT_ADMIN_UPLOAD_TMP_DIR, { recursive: true });
            cb(null, TENANT_ADMIN_UPLOAD_TMP_DIR);
        },
        filename(_req, file, cb) {
            const ext = path.extname(String(file.originalname || ''));
            cb(null, `upload-${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`);
        },
    }),
    limits: { fileSize: TENANT_ADMIN_UPLOAD_MAX_BYTES },
});

const uploadFdsSmokeZip = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: FDS_SMOKE_MAX_ZIP_BYTES },
});

/** POST /upload ハンドラ実行中（multer 完了後のリサイズ・保存含む） */
let activeTenantModelHttpUploads = 0;

const MODEL_UPLOAD_EXTS = new Set(['.glb', '.obj', '.mtl', '.png', '.jpg', '.jpeg', '.webp']);
const STORAGE_BULK_DELETE_MAX = 500;

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @param {string} fieldName
 */
function tenantAdminUploadSingle(fieldName, req, res, next) {
    if (activeTenantAdminMulterInFlight >= TENANT_ADMIN_UPLOAD_MAX_CONCURRENCY) {
        return res.status(503).json({
            error: 'upload_busy',
            message: 'Too many uploads in progress; retry shortly.',
        });
    }
    activeTenantAdminMulterInFlight += 1;
    let released = false;
    const releaseSlot = () => {
        if (released) return;
        released = true;
        activeTenantAdminMulterInFlight = Math.max(0, activeTenantAdminMulterInFlight - 1);
    };
    res.once('finish', releaseSlot);
    res.once('close', releaseSlot);

    upload.single(fieldName)(req, res, (err) => {
        if (err) {
            if (err.code === 'LIMIT_FILE_SIZE') {
                return res.status(413).json({
                    error: 'file_too_large',
                    message: `File exceeds maximum size (${Math.round(TENANT_ADMIN_UPLOAD_MAX_BYTES / (1024 * 1024))} MiB)`,
                });
            }
            console.error('[tenant-world-admin] multer upload:', err);
            return res.status(400).json({ error: 'upload_failed', message: err.message });
        }
        return next();
    });
}

/**
 * @param {Express.Multer.File | undefined} file
 * @returns {Buffer}
 */
function readUploadedFileBuffer(file) {
    if (!file) {
        throw new Error('No uploaded file');
    }
    if (file.buffer) {
        return file.buffer;
    }
    if (file.path) {
        return fs.readFileSync(file.path);
    }
    throw new Error('Uploaded file has no data');
}

/**
 * @param {Express.Multer.File | undefined} file
 */
function cleanupUploadedTempFile(file) {
    const tempPath = file?.path;
    if (!tempPath) return;
    try {
        fs.unlinkSync(tempPath);
    } catch {
        /* ignore */
    }
}

/**
 * @param {string} name
 * @returns {string}
 */
function safeUploadedFilename(name) {
    const base = path.basename(String(name || 'upload').trim() || 'upload');
    return base.replace(/[/\\<>:"|?*\x00-\x1f]/g, '_').replace(/^\.+/, '') || 'upload';
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {Record<string, unknown>} worlds
 */
export function writeTenantWorlds(tenant, worlds) {
    const worldsPath = tenant.paths.WORLDS_PATH;
    const dir = path.dirname(worldsPath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    const tmpPath = `${worldsPath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpPath, `${JSON.stringify(worlds, null, 2)}\n`, 'utf8');
    fs.renameSync(tmpPath, worldsPath);
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} next
 */
function attachTenant(req, res, next) {
    const tenantId = String(req.params.tenantId || '').trim();
    const tenant = getTenant(tenantId);
    if (!tenant) {
        return res.status(404).json({ error: 'tenant_not_found', tenantId });
    }
    req.tenant = tenant;
    return next();
}

/**
 * @param {string} tenantRoot
 * @param {string} storeRoot
 * @param {string} relQuery
 * @returns {string | null}
 */
function resolvePathUnderTenantStore(tenantRoot, storeRoot, relQuery) {
    const rootResolved = path.resolve(storeRoot);
    const rel = String(relQuery || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
    const segments = rel.split('/').filter((s) => s && s !== '.');
    if (segments.some((s) => s === '..')) return null;
    const abs = path.resolve(rootResolved, ...segments);
    if (!isPathInsideTenantRoot(tenantRoot, abs) || !abs.startsWith(rootResolved)) {
        return null;
    }
    return abs;
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @returns {Record<string, string>}
 */
function tenantStorageRoots(tenant) {
    const p = tenant.paths;
    return {
        models: p.MODELS_DIR,
        pdfs: p.PDFS_DIR,
        images: p.IMAGES_DIR,
        env: p.ENV_DIR,
        simulations: p.SIMULATIONS_DIR,
    };
}

/**
 * @param {import('express').Express} app
 */
export function registerTenantWorldAdminRoutes(app) {
    const base = '/admin/tenants/:tenantId';

    app.get(`${base}/client-config`, attachTenant, (req, res) => {
        const tenant = req.tenant;
        const storageCfg = getClientStorageConfig(tenant.id);
        res.setHeader('Cache-Control', 'private, no-store, max-age=0');
        res.json({
            service: 'metaverse-simulation-tenant',
            tenantId: tenant.id,
            socketPath: `/${tenant.id}/socket.io`,
            defaultRoom: 'lobby',
            portalLinks: getPortalLinksForRequest(req),
            chartFeaturesEnabled: false,
            storageBackend: storageCfg.storageBackend,
            assetModels: storageCfg.assetModels,
            worldLoadConcurrency: 24,
        });
    });

    registerTenantR2AdminRoutes(app, base, attachTenant);

    app.post(`${base}/worlds`, attachTenant, (req, res) => {
        const worlds = req.body;
        if (!worlds || typeof worlds !== 'object') {
            return res.status(400).json({ error: 'Invalid body: expected worlds object' });
        }
        const physicsErrs = validateWorldsPhysicsAssist(worlds);
        if (physicsErrs.length > 0) {
            return res.status(400).json({ error: physicsErrs.join(' ') });
        }
        const boundsErrs = validateWorldsPlayBoundsAndColliders(worlds);
        if (boundsErrs.length > 0) {
            return res.status(400).json({ error: boundsErrs.join(' ') });
        }
        const floorErrs = validateWorldsFloorDimensions(worlds);
        if (floorErrs.length > 0) {
            return res.status(400).json({ error: floorErrs.join(' ') });
        }
        normalizeWorldsLod(worlds);
        normalizeWorldsRod(worlds);
        try {
            writeTenantWorlds(req.tenant, worlds);
            res.json({ success: true });
        } catch (err) {
            console.error('[tenant-world-admin] POST worlds failed:', err);
            res.status(500).json({ error: 'Failed to save worlds' });
        }
    });

    app.get(`${base}/models`, attachTenant, async (req, res) => {
        try {
            const names = await listMergedTenantStoreFilenames(req.tenant, 'models', (n) => {
                const low = n.toLowerCase();
                return low.endsWith('.glb') || low.endsWith('.obj');
            });
            res.json(names);
        } catch (err) {
            console.error('[tenant-world-admin] GET models:', err);
            res.status(500).json({ error: 'Failed to list models' });
        }
    });

    app.get(`${base}/model-mtls`, attachTenant, async (req, res) => {
        try {
            const names = await listMergedTenantStoreFilenames(req.tenant, 'models', (n) =>
                n.toLowerCase().endsWith('.mtl')
            );
            res.json(names);
        } catch (err) {
            console.error('[tenant-world-admin] GET model-mtls:', err);
            res.status(500).json({ error: 'Failed to list model MTL files' });
        }
    });

    app.get(`${base}/prefab-manifests`, attachTenant, async (req, res) => {
        try {
            const names = await listMergedTenantStoreFilenames(req.tenant, 'models', (n) =>
                n.toLowerCase().endsWith('-prefab-manifest.json')
            );
            res.json(names);
        } catch (err) {
            console.error('[tenant-world-admin] GET prefab-manifests:', err);
            res.status(500).json({ error: 'Failed to list prefab manifests' });
        }
    });

    app.get(`${base}/plane-prefab-manifests`, attachTenant, (_req, res) => {
        res.json([]);
    });

    app.get(`${base}/pdfs`, attachTenant, async (req, res) => {
        try {
            const names = await listMergedTenantStoreFilenames(req.tenant, 'pdfs', (n) =>
                n.toLowerCase().endsWith('.pdf')
            );
            res.json(names);
        } catch (err) {
            console.error('[tenant-world-admin] GET pdfs:', err);
            res.status(500).json({ error: 'Failed to list PDFs' });
        }
    });

    app.get(`${base}/model-upload-queue`, attachTenant, (_req, res) => {
        const q = getTenantModelUploadQueueStats();
        res.json({
            waiting: q.waiting,
            processing: q.processing || activeTenantModelHttpUploads > 0,
        });
    });

    app.get(`${base}/charts`, attachTenant, (_req, res) => {
        res.status(503).json({
            error: '譜面機能はこのサーバーでは無効です',
            chartFeaturesEnabled: false,
        });
    });

    app.get(`${base}/addons/aircraft/airframes`, attachTenant, (_req, res) => {
        res.json({ airframes: [] });
    });

    app.get(`${base}/storage-files`, attachTenant, async (req, res) => {
        const store = typeof req.query.store === 'string' ? req.query.store.trim() : '';
        const roots = tenantStorageRoots(req.tenant);
        const storeRoot = roots[store];
        if (!storeRoot) {
            return res.status(400).json({ error: 'Invalid or missing store' });
        }
        // FDS 煙 ZIP は現状ローカル tenants/data/simulations にのみ保存（R2 未ミラー）
        const useLocalListing = store === 'simulations' || !isR2Enabled();
        if (!useLocalListing) {
            return handleR2StorageFilesList(req, res);
        }
        if (store === 'chart-bgm') {
            return res.status(503).json({
                error: '譜面機能はこのサーバーでは無効です',
                chartFeaturesEnabled: false,
            });
        }
        const relQuery = typeof req.query.path === 'string' ? req.query.path : '';
        const dirAbs = resolvePathUnderTenantStore(req.tenant.paths.TENANT_ROOT, storeRoot, relQuery);
        if (!dirAbs) {
            return res.status(400).json({ error: 'Invalid path' });
        }
        try {
            if (!fs.existsSync(dirAbs)) {
                return res.status(404).json({ error: 'Path not found' });
            }
            const st = fs.statSync(dirAbs);
            if (!st.isDirectory()) {
                return res.status(400).json({ error: 'Not a directory' });
            }
            const rootResolved = path.resolve(storeRoot);
            const names = fs.readdirSync(dirAbs, { withFileTypes: true });
            const entries = [];
            for (const d of names) {
                const abs = path.join(dirAbs, d.name);
                let size = null;
                let mtimeMs = null;
                try {
                    const fst = fs.statSync(abs);
                    mtimeMs = fst.mtimeMs;
                    if (fst.isFile()) size = fst.size;
                } catch {
                    /* ignore */
                }
                entries.push({
                    name: d.name,
                    isDirectory: d.isDirectory(),
                    size,
                    mtimeMs,
                });
            }
            entries.sort((a, b) => {
                if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
                return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
            });
            const prefix = path.relative(rootResolved, dirAbs);
            const currentRelative = prefix ? prefix.split(path.sep).join('/') : '';
            res.json({ store, currentRelative, entries });
        } catch (err) {
            console.error('[tenant-world-admin] GET storage-files:', err);
            res.status(500).json({ error: 'Failed to list directory' });
        }
    });

    app.post(`${base}/storage-files/bulk-delete`, attachTenant, express.json(), async (req, res) => {
        const store = typeof req.body?.store === 'string' ? req.body.store.trim() : '';
        const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
        const roots = tenantStorageRoots(req.tenant);
        const storeRoot = roots[store];
        if (!storeRoot) {
            return res.status(400).json({ error: 'Invalid or missing store' });
        }
        if (paths.length === 0) {
            return res.status(400).json({ error: 'paths is required' });
        }
        if (paths.length > STORAGE_BULK_DELETE_MAX) {
            return res.status(400).json({ error: `Too many paths (max ${STORAGE_BULK_DELETE_MAX})` });
        }
        const useLocalDelete = store === 'simulations' || !isR2Enabled();
        if (!useLocalDelete) {
            return handleR2StorageFilesBulkDelete(req, res);
        }
        const deleted = [];
        const errors = [];
        for (const rel of paths) {
            const relStr = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
            const abs = resolvePathUnderTenantStore(
                req.tenant.paths.TENANT_ROOT,
                storeRoot,
                relStr
            );
            if (!abs) {
                errors.push({ path: relStr, error: 'invalid_path' });
                continue;
            }
            try {
                const st = fs.statSync(abs);
                if (st.isDirectory()) {
                    errors.push({ path: relStr, error: 'is_directory' });
                    continue;
                }
                fs.unlinkSync(abs);
                deleted.push(relStr);
            } catch (e) {
                errors.push({
                    path: relStr,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }
        res.json({ deleted, errors });
    });

    app.post(`${base}/upload`, attachTenant, (req, res, next) =>
        tenantAdminUploadSingle('model', req, res, next), async (req, res) => {
        if (!req.file) {
            return res.status(400).json({ error: 'No file or invalid file' });
        }

        const allowOverwrite = req.query.confirm === '1';
        const skipTextureResize =
            req.body?.skipTextureResize === '1' || req.body?.skipTextureResize === 'true';

        activeTenantModelHttpUploads += 1;
        try {
            const result = await saveTenantModelUpload(
                req.tenant,
                {
                    buffer: readUploadedFileBuffer(req.file),
                    originalname: req.file.originalname,
                },
                {
                    allowOverwrite,
                    skipTextureResize,
                    textureMaxEdge: req.body?.textureMaxEdge,
                    requestBody: req.body,
                }
            );

            if (result.conflict) {
                return res.status(409).json({ error: 'file_exists', filename: result.filename });
            }

            const payload = {
                success: true,
                filename: result.filename,
            };
            if (result.textureResize) {
                payload.textureResize = result.textureResize;
            }
            res.json(payload);
        } catch (err) {
            const code = err && typeof err === 'object' && 'code' in err ? err.code : '';
            if (code === 'invalid_texture_max_edge') {
                return res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
            }
            console.error('[tenant-world-admin] POST upload:', err);
            res.status(500).json({ error: 'Failed to save file' });
        } finally {
            activeTenantModelHttpUploads = Math.max(0, activeTenantModelHttpUploads - 1);
            cleanupUploadedTempFile(req.file);
        }
    });

    app.post(`${base}/upload-pdf`, attachTenant, (req, res, next) =>
        tenantAdminUploadSingle('pdf', req, res, next), (req, res) => {
        if (isR2Enabled()) {
            cleanupUploadedTempFile(req.file);
            return res.status(400).json({ error: 'use_r2_storage' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file or invalid file' });
        }
        let filename = safeUploadedFilename(req.file.originalname);
        if (!filename.toLowerCase().endsWith('.pdf')) {
            filename = `${filename}.pdf`;
        }
        const destDir = req.tenant.paths.PDFS_DIR;
        const destPath = path.join(destDir, filename);
        if (fs.existsSync(destPath) && req.query.confirm !== '1') {
            cleanupUploadedTempFile(req.file);
            return res.status(409).json({ error: 'file_exists', filename });
        }
        try {
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }
            fs.copyFileSync(req.file.path, destPath);
            res.json({ success: true, filename });
        } catch (err) {
            console.error('[tenant-world-admin] POST upload-pdf:', err);
            res.status(500).json({ error: 'Failed to save file' });
        } finally {
            cleanupUploadedTempFile(req.file);
        }
    });

    app.post(`${base}/upload-hdr`, attachTenant, (req, res, next) =>
        tenantAdminUploadSingle('hdr', req, res, next), (req, res) => {
        if (isR2Enabled()) {
            cleanupUploadedTempFile(req.file);
            return res.status(400).json({ error: 'use_r2_storage' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file or invalid file (.hdr only)' });
        }
        const ext = path.extname(req.file.originalname || '').toLowerCase();
        if (ext !== '.hdr') {
            cleanupUploadedTempFile(req.file);
            return res.status(400).json({ error: 'Only .hdr files are allowed' });
        }
        const destName = 'default.hdr';
        const destDir = req.tenant.paths.ENV_DIR;
        const destPath = path.join(destDir, destName);
        if (fs.existsSync(destPath) && req.query.confirm !== '1') {
            cleanupUploadedTempFile(req.file);
            return res.status(409).json({ error: 'file_exists', filename: destName });
        }
        try {
            if (!fs.existsSync(destDir)) {
                fs.mkdirSync(destDir, { recursive: true });
            }
            fs.copyFileSync(req.file.path, destPath);
            res.json({ success: true, filename: destName, url: `/env/${destName}` });
        } catch (err) {
            console.error('[tenant-world-admin] POST upload-hdr:', err);
            res.status(500).json({ error: 'Failed to save HDR' });
        } finally {
            cleanupUploadedTempFile(req.file);
        }
    });

    app.post(`${base}/upload-avatar`, attachTenant, (req, res, next) =>
        tenantAdminUploadSingle('avatar', req, res, next), (req, res) => {
        if (isR2Enabled()) {
            cleanupUploadedTempFile(req.file);
            return res.status(400).json({ error: 'use_r2_storage' });
        }
        if (!req.file) {
            return res.status(400).json({ error: 'No file or invalid file' });
        }
        const ext = path.extname(req.file.originalname || '').toLowerCase();
        if (ext !== '.glb') {
            cleanupUploadedTempFile(req.file);
            return res.status(400).json({ error: 'Only .glb avatars are allowed' });
        }
        const filename = safeUploadedFilename(req.file.originalname);
        const avatarsDir = path.join(req.tenant.paths.TENANT_ROOT, 'avatars');
        const destPath = path.join(avatarsDir, filename);
        try {
            if (!fs.existsSync(avatarsDir)) {
                fs.mkdirSync(avatarsDir, { recursive: true });
            }
            fs.copyFileSync(req.file.path, destPath);
            res.json({ success: true, filename });
        } catch (err) {
            console.error('[tenant-world-admin] POST upload-avatar:', err);
            res.status(500).json({ error: 'Failed to save avatar' });
        } finally {
            cleanupUploadedTempFile(req.file);
        }
    });

    app.post(`${base}/upload-prefab-zip`, attachTenant, (req, res, next) =>
        tenantAdminUploadSingle('zip', req, res, next), (req, res) => {
        cleanupUploadedTempFile(req.file);
        res.status(501).json({
            error: 'prefab_zip_not_supported',
            message: 'Prefab ZIP は現バージョンでは Tenant 管理から未対応です。models/ に手動配置してください。',
        });
    });

    app.post(`${base}/upload-plane-prefab-zip`, attachTenant, (req, res, next) =>
        tenantAdminUploadSingle('zip', req, res, next), (req, res) => {
        cleanupUploadedTempFile(req.file);
        res.status(501).json({ error: 'plane_prefab_zip_not_supported' });
    });

    app.get(`${base}/simulations`, attachTenant, (req, res) => {
        try {
            const simulations = listSimulations(req.tenant.paths.SIMULATIONS_DIR);
            res.json({ simulations });
        } catch (err) {
            console.error('[tenant-world-admin] GET simulations:', err);
            res.status(500).json({ error: 'Failed to list simulations' });
        }
    });

    app.post(`${base}/upload-fds-smoke-zip`, attachTenant, (req, res) => {
        uploadFdsSmokeZip.single('zip')(req, res, (multerErr) => {
            if (multerErr) {
                if (multerErr.code === 'LIMIT_FILE_SIZE') {
                    return res.status(413).json({
                        error: 'file_too_large',
                        message: `ZIP exceeds maximum size (${Math.round(FDS_SMOKE_MAX_ZIP_BYTES / (1024 * 1024))} MiB)`,
                    });
                }
                console.error('[tenant-world-admin] upload-fds-smoke-zip multer:', multerErr);
                return res.status(400).json({ error: 'upload_failed', message: multerErr.message });
            }

            if (!req.file) {
                return res.status(400).json({ error: 'No file or invalid file' });
            }
        const ext = path.extname(req.file.originalname || '').toLowerCase();
        if (ext !== '.zip') {
            return res.status(400).json({ error: 'Only .zip files are allowed' });
        }

        const bodySimId = typeof req.body?.simId === 'string' ? req.body.simId.trim() : '';
        const querySimId = typeof req.query.simId === 'string' ? req.query.simId.trim() : '';
        const simId = bodySimId || querySimId || simIdFromZipFilename(req.file.originalname);
        const confirmOverwrite = req.query.confirm === '1';

        try {
            const { entries } = extractFdsSmokeZip(req.file.buffer);
            saveFdsSmokeSimulation(
                req.tenant.paths.TENANT_ROOT,
                req.tenant.paths.SIMULATIONS_DIR,
                simId,
                entries,
                confirmOverwrite,
            );
            res.json({
                success: true,
                simId,
                manifestPath: `simulations/${simId}/manifest.json`,
            });
        } catch (err) {
            if (err instanceof FdsSmokeUploadError) {
                const status = err.code === 'sim_exists' ? 409 : 400;
                return res.status(status).json({ error: err.code, message: err.message });
            }
            console.error('[tenant-world-admin] POST upload-fds-smoke-zip:', err);
            return res.status(500).json({ error: 'Failed to save simulation' });
        }
        });
    });

    app.delete(`${base}/simulations/:simId`, attachTenant, (req, res) => {
        const simId = String(req.params.simId || '').trim();
        if (!isValidSimId(simId)) {
            return res.status(400).json({ error: 'invalid_sim_id' });
        }
        try {
            deleteFdsSmokeSimulation(
                req.tenant.paths.TENANT_ROOT,
                req.tenant.paths.SIMULATIONS_DIR,
                simId,
            );
            res.json({ success: true, simId });
        } catch (err) {
            if (err instanceof FdsSmokeUploadError) {
                const status = err.code === 'not_found' ? 404 : 400;
                return res.status(status).json({ error: err.code, message: err.message });
            }
            console.error('[tenant-world-admin] DELETE simulations:', err);
            return res.status(500).json({ error: 'Failed to delete simulation' });
        }
    });
}
