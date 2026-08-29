// lib/r2/tenant-r2-admin-routes.js — 管理 API R2 ストレージルート

import express from 'express';
import multer from 'multer';
import {
    abortUpload,
    completeUpload,
    getPartUploadPresignedUrl,
    getSimpleUploadPresignedUrl,
    initiateUpload,
    objectExists,
    proxySimpleUpload,
    proxyUploadPart,
} from './upload.js';
import { bulkDeleteTenantFiles, listTenantStorageDirectory } from './tenant-storage.js';
import { isR2Enabled } from './storage-backend.js';
import { getDownloadMode, getPresignedDownloadUrl } from './download.js';
import { toR2Key } from './r2-keys.js';

const proxyUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 150 * 1024 * 1024 },
});

/**
 * R2 管理ルートを登録する
 * @param {import('express').Express} app
 * @param {string} base
 * @param {(req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => void} attachTenant
 */
export function registerTenantR2AdminRoutes(app, base, attachTenant) {
    if (!isR2Enabled()) return;

    app.post(`${base}/r2-storage/upload/init`, attachTenant, express.json(), async (req, res) => {
        try {
            const store = typeof req.body?.store === 'string' ? req.body.store.trim() : '';
            const filename = typeof req.body?.filename === 'string' ? req.body.filename : '';
            const size = Number(req.body?.size);
            const relativeDir = typeof req.body?.path === 'string' ? req.body.path : '';
            const allowOverwrite = req.body?.allowOverwrite === true || req.query.confirm === '1';
            const forceFilename = typeof req.body?.forceFilename === 'string' ? req.body.forceFilename : undefined;

            if (!store || !filename || !Number.isFinite(size) || size <= 0) {
                return res.status(400).json({ error: 'store, filename, size are required' });
            }

            if (!allowOverwrite) {
                const relPath = relativeDir
                    ? `${relativeDir.replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '')}/${filename}`
                    : filename;
                const exists = await objectExists(req.tenant.id, store, relPath);
                if (exists) {
                    return res.status(409).json({ error: 'file_exists', filename });
                }
            }

            const result = await initiateUpload(
                req.tenant.id,
                store,
                relativeDir,
                filename,
                size,
                { allowOverwrite, forceFilename }
            );
            res.json(result);
        } catch (err) {
            console.error('[r2-admin] upload/init:', err);
            res.status(400).json({ error: err instanceof Error ? err.message : 'init failed' });
        }
    });

    app.get(`${base}/r2-storage/upload/url`, attachTenant, async (req, res) => {
        try {
            const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
            if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
            const result = await getSimpleUploadPresignedUrl(req.tenant.id, sessionId);
            res.json(result);
        } catch (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : 'url failed' });
        }
    });

    app.get(`${base}/r2-storage/upload/part-url`, attachTenant, async (req, res) => {
        try {
            const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
            const partNumber = Number(req.query.partNumber);
            if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
            const result = await getPartUploadPresignedUrl(req.tenant.id, sessionId, partNumber);
            res.json(result);
        } catch (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : 'part-url failed' });
        }
    });

    app.put(`${base}/r2-storage/upload/simple`, attachTenant, proxyUpload.single('file'), async (req, res) => {
        try {
            const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
            if (!sessionId || !req.file) {
                return res.status(400).json({ error: 'sessionId and file required' });
            }
            const result = await proxySimpleUpload(req.tenant.id, sessionId, req.file.buffer);
            res.json(result);
        } catch (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : 'simple upload failed' });
        }
    });

    app.put(`${base}/r2-storage/upload/part`, attachTenant, proxyUpload.single('file'), async (req, res) => {
        try {
            const sessionId = typeof req.query.sessionId === 'string' ? req.query.sessionId : '';
            const partNumber = Number(req.query.partNumber);
            if (!sessionId || !req.file) {
                return res.status(400).json({ error: 'sessionId and file required' });
            }
            const part = await proxyUploadPart(req.tenant.id, sessionId, partNumber, req.file.buffer);
            res.json(part);
        } catch (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : 'part upload failed' });
        }
    });

    app.post(`${base}/r2-storage/upload/complete`, attachTenant, express.json(), async (req, res) => {
        try {
            const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
            const parts = Array.isArray(req.body?.parts) ? req.body.parts : undefined;
            const directUpload = req.body?.directUpload === true;
            if (!sessionId) return res.status(400).json({ error: 'sessionId required' });
            const result = await completeUpload(req.tenant.id, sessionId, parts, directUpload);
            res.json(result);
        } catch (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : 'complete failed' });
        }
    });

    app.post(`${base}/r2-storage/upload/abort`, attachTenant, express.json(), async (req, res) => {
        const sessionId = typeof req.body?.sessionId === 'string' ? req.body.sessionId : '';
        if (sessionId) {
            await abortUpload(req.tenant.id, sessionId);
        }
        res.json({ success: true });
    });

    app.get(`${base}/r2-storage/download/url`, attachTenant, async (req, res) => {
        try {
            const store = typeof req.query.store === 'string' ? req.query.store : '';
            const relPath = typeof req.query.path === 'string' ? req.query.path : '';
            if (!store || !relPath) {
                return res.status(400).json({ error: 'store and path required' });
            }
            if (getDownloadMode() !== 'direct') {
                return res.json({ mode: 'proxy' });
            }
            const r2Key = toR2Key(req.tenant.id, store, relPath);
            const filename = relPath.split('/').pop() ?? 'download';
            const result = await getPresignedDownloadUrl(r2Key, filename);
            res.json({ mode: 'direct', ...result });
        } catch (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : 'download url failed' });
        }
    });
}

/**
 * R2 向け storage-files ハンドラ
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleR2StorageFilesList(req, res) {
    const store = typeof req.query.store === 'string' ? req.query.store.trim() : '';
    if (store === 'chart-bgm') {
        return res.status(503).json({
            error: '譜面機能はこのサーバーでは無効です',
            chartFeaturesEnabled: false,
        });
    }
    const relQuery = typeof req.query.path === 'string' ? req.query.path : '';
    try {
        const result = await listTenantStorageDirectory(req.tenant.id, store, relQuery);
        res.json(result);
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Invalid')) {
            return res.status(400).json({ error: msg });
        }
        console.error('[r2-admin] storage-files:', err);
        res.status(500).json({ error: 'Failed to list directory' });
    }
}

/**
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
export async function handleR2StorageFilesBulkDelete(req, res) {
    const store = typeof req.body?.store === 'string' ? req.body.store.trim() : '';
    const paths = Array.isArray(req.body?.paths) ? req.body.paths : [];
    try {
        const result = await bulkDeleteTenantFiles(req.tenant.id, store, paths);
        res.json(result);
    } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'delete failed' });
    }
}
