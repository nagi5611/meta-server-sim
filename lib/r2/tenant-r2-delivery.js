// lib/r2/tenant-r2-delivery.js — テナント公開 API の R2 配信

import { pipeline } from 'node:stream/promises';
import { getDownloadMode, getPresignedDownloadUrl, streamObject } from './download.js';
import { headObject } from './r2-s3-client.js';
import { guessContentType, isValidStore, toR2Key } from './r2-keys.js';
import { isR2Enabled } from './storage-backend.js';
import { presignGetObject } from './r2-presign.js';

/** store 名と URL プレフィックスの対応 */
export const STORE_URL_MAP = {
    models: 'models',
    pdfs: 'pdfs',
    images: 'images',
    env: 'env',
    avatars: 'avatars',
};

/**
 * URL プレフィックスから store を解決する
 * @param {string} urlPrefix
 * @returns {string | null}
 */
export function storeFromUrlPrefix(urlPrefix) {
    const normalized = String(urlPrefix || '').replace(/^\/+/, '').replace(/\/+$/, '');
    for (const [store, prefix] of Object.entries(STORE_URL_MAP)) {
        if (prefix === normalized) return store;
    }
    return null;
}

/**
 * R2 静的ファイル配信ハンドラ
 * @param {import('../tenant-registry.js').TenantRecord} tenant
 * @param {string} store
 * @returns {import('express').RequestHandler}
 */
export function createR2StaticHandler(tenant, store) {
    return async (req, res, next) => {
        try {
            const rel = req.path.replace(/^\/+/, '');
            if (rel.includes('..')) {
                return res.status(403).json({ error: 'forbidden_path' });
            }

            const r2Key = toR2Key(tenant.id, store, rel);
            const head = await headObject(r2Key);
            if (!head) {
                return res.status(404).end();
            }

            if (getDownloadMode() === 'direct') {
                const filename = rel.split('/').pop() ?? 'download';
                const { url } = await getPresignedDownloadUrl(r2Key, filename);
                return res.redirect(302, url);
            }

            const streamed = await streamObject(r2Key);
            if (!streamed) {
                return res.status(404).end();
            }

            res.setHeader('Content-Type', streamed.contentType);
            if (streamed.contentLength) {
                res.setHeader('Content-Length', String(streamed.contentLength));
            }
            await pipeline(streamed.stream, res);
        } catch (err) {
            next(err);
        }
    };
}

/**
 * 論理パスから R2 キーを解決する
 * @param {string} tenantId
 * @param {string} logicalPath models/foo.glb 等
 * @returns {string | null}
 */
export function logicalPathToR2Key(tenantId, logicalPath) {
    const posix = String(logicalPath || '').replace(/^\/+/, '').replace(/\\/g, '/');
    const slash = posix.indexOf('/');
    if (slash <= 0) return null;
    const storePart = posix.slice(0, slash);
    const rel = posix.slice(slash + 1);
    if (!isValidStore(storePart) || !rel) return null;
    try {
        return toR2Key(tenantId, storePart, rel);
    } catch {
        return null;
    }
}

/**
 * 署名 URL バッチ発行
 * @param {string} tenantId
 * @param {string[]} paths 論理パス配列
 * @returns {Promise<Record<string, string>>}
 */
export async function signAssetPaths(tenantId, paths) {
    const signed = {};
    for (const p of paths) {
        const raw = String(p || '').trim();
        if (!raw) continue;
        const r2Key = logicalPathToR2Key(tenantId, raw);
        if (!r2Key) continue;
        const filename = raw.split('/').pop() ?? 'asset';
        const url = await presignGetObject(r2Key, {
            responseContentType: guessContentType(filename),
        });
        signed[raw] = url;
    }
    return signed;
}

/**
 * R2 上のオブジェクト存在確認
 * @param {string} tenantId
 * @param {string} store
 * @param {string} relativePath
 */
export async function r2ObjectExists(tenantId, store, relativePath) {
    const r2Key = toR2Key(tenantId, store, relativePath);
    const head = await headObject(r2Key);
    return Boolean(head);
}

/**
 * @returns {boolean}
 */
export function isR2StorageActive() {
    return isR2Enabled();
}
