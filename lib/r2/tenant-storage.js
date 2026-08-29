// lib/r2/tenant-storage.js — テナント R2 一覧・削除

import { deleteObject, headObject, listObjects } from './r2-s3-client.js';
import { isValidRelativePath, isValidStore, listPrefix, toR2Key } from './r2-keys.js';

/**
 * ディレクトリ一覧
 * @param {string} tenantId
 * @param {string} store
 * @param {string} relativeDir
 */
export async function listTenantStorageDirectory(tenantId, store, relativeDir = '') {
    if (!isValidStore(store)) {
        throw new Error('Invalid store');
    }
    const rel = String(relativeDir || '')
        .replace(/\\/g, '/')
        .replace(/^\/+/, '')
        .replace(/\/+$/, '');
    if (rel && !isValidRelativePath(rel)) {
        throw new Error('Invalid path');
    }

    const prefix = listPrefix(tenantId, store, rel);
    const { objects, prefixes } = await listObjects(prefix);

    const entries = [];
    const seenDirs = new Set();

    for (const p of prefixes) {
        const name = p.slice(prefix.length).replace(/\/$/, '');
        if (!name || seenDirs.has(name)) continue;
        seenDirs.add(name);
        entries.push({
            name,
            isDirectory: true,
            size: null,
            mtimeMs: null,
        });
    }

    for (const obj of objects) {
        const name = obj.key.slice(prefix.length);
        if (!name || name.includes('/')) continue;
        entries.push({
            name,
            isDirectory: false,
            size: obj.size,
            mtimeMs: obj.lastModified ? obj.lastModified.getTime() : null,
        });
    }

    entries.sort((a, b) => {
        if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    return {
        store,
        currentRelative: rel,
        entries,
    };
}

/**
 * ファイル削除
 * @param {string} tenantId
 * @param {string} store
 * @param {string[]} relativePaths
 */
export async function bulkDeleteTenantFiles(tenantId, store, relativePaths) {
    if (!isValidStore(store)) {
        throw new Error('Invalid store');
    }

    const deleted = [];
    const errors = [];

    for (const rel of relativePaths) {
        const relStr = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
        if (!relStr || !isValidRelativePath(relStr)) {
            errors.push({ path: relStr, error: 'invalid_path' });
            continue;
        }
        try {
            const r2Key = toR2Key(tenantId, store, relStr);
            const head = await headObject(r2Key);
            if (!head) {
                errors.push({ path: relStr, error: 'not_found' });
                continue;
            }
            await deleteObject(r2Key);
            deleted.push(relStr);
        } catch (e) {
            errors.push({
                path: relStr,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    return { deleted, errors };
}

/**
 * store 内のファイル名一覧（フラット、拡張子フィルタ可）
 * @param {string} tenantId
 * @param {string} store
 * @param {(name: string) => boolean} [filter]
 * @returns {Promise<string[]>}
 */
export async function listTenantStoreFilenames(tenantId, store, filter) {
    const prefix = listPrefix(tenantId, store, '');
    const { objects } = await listObjects(prefix, '');
    const names = [];
    for (const obj of objects) {
        const name = obj.key.slice(prefix.length);
        if (!name || name.includes('/')) continue;
        if (!filter || filter(name)) {
            names.push(name);
        }
    }
    return names.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
