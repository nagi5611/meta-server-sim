// lib/tenant-asset-cache-headers.js — テナント静的 GLB 等の LB/CDN/ブラウザ ディスクキャッシュ
import fs from 'node:fs';

const DEFAULT_GLB_MAX_AGE_SEC = 2_592_000; // 30d
const DEFAULT_OTHER_ASSET_MAX_AGE_SEC = 86_400; // 1d

/**
 * @returns {number}
 */
export function getTenantGlbCacheMaxAgeSec() {
    const n = Number.parseInt(process.env.TENANT_GLB_CACHE_MAX_AGE || '', 10);
    return Number.isFinite(n) && n > 0 ? n : DEFAULT_GLB_MAX_AGE_SEC;
}

/**
 * 長期ディスクキャッシュ対象（同一 URL は immutable 想定・アップロード時に SW invalidate）
 * @param {string} relativePath
 */
export function isTenantImmutableDiskCacheAsset(relativePath) {
    const low = String(relativePath || '').toLowerCase();
    return (
        low.endsWith('.glb') ||
        low.endsWith('.hdr') ||
        low.endsWith('.wasm') ||
        low.endsWith('.bin')
    );
}

/**
 * @param {string} relativePath
 * @returns {number} max-age 秒
 */
export function tenantAssetCacheMaxAgeSec(relativePath) {
    return isTenantImmutableDiskCacheAsset(relativePath)
        ? getTenantGlbCacheMaxAgeSec()
        : DEFAULT_OTHER_ASSET_MAX_AGE_SEC;
}

/**
 * @param {import('fs').Stats} stat
 * @returns {string}
 */
export function etagFromFileStat(stat) {
    const mtime = Math.trunc(stat.mtimeMs);
    return `"${stat.size.toString(16)}-${mtime.toString(16)}"`;
}

/**
 * @param {import('express').Response} res
 * @param {string} relativePath
 * @param {{ etag?: string, lastModified?: Date | string }} [meta]
 */
export function applyTenantAssetDiskCacheHeaders(res, relativePath, meta = {}) {
    const maxAge = tenantAssetCacheMaxAgeSec(relativePath);
    const immutable = isTenantImmutableDiskCacheAsset(relativePath);
    const parts = [`public`, `max-age=${maxAge}`];
    if (immutable) parts.push('immutable');
    res.setHeader('Cache-Control', parts.join(', '));
    if (meta.etag) {
        res.setHeader('ETag', meta.etag);
    }
    if (meta.lastModified) {
        const lm =
            meta.lastModified instanceof Date
                ? meta.lastModified
                : new Date(meta.lastModified);
        if (!Number.isNaN(lm.getTime())) {
            res.setHeader('Last-Modified', lm.toUTCString());
        }
    }
}

/**
 * ローカルファイル向けヘッダ（sendFile 前）
 * @param {import('express').Response} res
 * @param {string} filePath
 * @param {string} relativePath
 */
export function applyTenantLocalAssetCacheHeaders(res, filePath, relativePath) {
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch {
        applyTenantAssetDiskCacheHeaders(res, relativePath);
        return;
    }
    applyTenantAssetDiskCacheHeaders(res, relativePath, {
        etag: etagFromFileStat(stat),
        lastModified: stat.mtime,
    });
}
