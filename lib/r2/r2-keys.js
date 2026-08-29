// lib/r2/r2-keys.js — テナント R2 キー命名

import path from 'node:path';
import { getKeyPrefix } from './storage-backend.js';
import { TENANT_STORES } from './constants.js';

/**
 * ファイル名をサニタイズする
 * @param {string} name
 * @returns {string}
 */
export function sanitizeFilename(name) {
    const base = path.basename(String(name || 'upload').trim() || 'upload');
    return base.replace(/[/\\<>:"|?*\x00-\x1f]/g, '_').replace(/^\.+/, '') || 'upload';
}

/**
 * store 名が有効か
 * @param {string} store
 * @returns {boolean}
 */
export function isValidStore(store) {
    return TENANT_STORES.has(String(store || '').trim());
}

/**
 * 相対パスを検証する
 * @param {string} relativePath
 * @returns {boolean}
 */
export function isValidRelativePath(relativePath) {
    const rel = String(relativePath || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
    const segments = rel.split('/').filter((s) => s && s !== '.');
    if (segments.some((s) => s === '..')) return false;
    return true;
}

/**
 * R2 オブジェクトキーを生成する
 * @param {string} tenantId
 * @param {string} store
 * @param {string} relativePath
 * @returns {string}
 */
export function toR2Key(tenantId, store, relativePath) {
    if (!isValidStore(store)) {
        throw new Error('Invalid store');
    }
    const rel = String(relativePath || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '');
    if (!isValidRelativePath(rel)) {
        throw new Error('Invalid relative path');
    }
    const prefix = getKeyPrefix();
    const tid = String(tenantId || '').trim();
    if (!tid) throw new Error('Invalid tenantId');
    return `${prefix}/tenants/${tid}/${store}/${rel}`;
}

/**
 * R2 キーから store と相対パスを復元する
 * @param {string} tenantId
 * @param {string} r2Key
 * @returns {{ store: string, relativePath: string } | null}
 */
export function parseR2Key(tenantId, r2Key) {
    const prefix = getKeyPrefix();
    const expected = `${prefix}/tenants/${tenantId}/`;
    if (!r2Key.startsWith(expected)) return null;
    const rest = r2Key.slice(expected.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) return null;
    const store = rest.slice(0, slash);
    const relativePath = rest.slice(slash + 1);
    if (!isValidStore(store) || !relativePath) return null;
    return { store, relativePath };
}

/**
 * 一覧用プレフィックス
 * @param {string} tenantId
 * @param {string} store
 * @param {string} [relativeDir]
 * @returns {string}
 */
export function listPrefix(tenantId, store, relativeDir = '') {
    const rel = String(relativeDir || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
    if (rel && !isValidRelativePath(rel)) {
        throw new Error('Invalid relative path');
    }
    const base = toR2Key(tenantId, store, rel || '_placeholder_').replace(/_placeholder_$/, '');
    return rel ? `${base}/` : base;
}

/**
 * 自動リネーム名を生成する
 * @param {string} filename
 * @param {number} index
 * @returns {string}
 */
export function buildAutoRenameName(filename, index) {
    const dot = filename.lastIndexOf('.');
    if (dot > 0) {
        return `${filename.slice(0, dot)} (${index})${filename.slice(dot)}`;
    }
    return `${filename} (${index})`;
}

/**
 * Content-Type を推定する
 * @param {string} filename
 * @returns {string}
 */
export function guessContentType(filename) {
    const ext = path.extname(filename).toLowerCase();
    const map = {
        '.glb': 'model/gltf-binary',
        '.obj': 'model/obj',
        '.mtl': 'model/mtl',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.webp': 'image/webp',
        '.pdf': 'application/pdf',
        '.hdr': 'application/octet-stream',
        '.zip': 'application/zip',
    };
    return map[ext] || 'application/octet-stream';
}
