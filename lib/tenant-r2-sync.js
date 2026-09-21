// lib/tenant-r2-sync.js — ローカルテナントアセットと R2 の整合性を保つ

import fs from 'node:fs';
import path from 'node:path';
import { isPathInsideTenantRoot } from './tenant-storage-paths.js';
import { guessContentType, isValidRelativePath, toR2Key } from './r2/r2-keys.js';
import { headObject, putObject } from './r2/r2-s3-client.js';
import { isR2Enabled } from './r2/storage-backend.js';

/** R2 とミラーするストア（simulations はローカル専用のため除外） */
const SYNC_STORES = [
    { store: 'models', localDir: (paths) => paths.MODELS_DIR },
    { store: 'pdfs', localDir: (paths) => paths.PDFS_DIR },
    { store: 'images', localDir: (paths) => paths.IMAGES_DIR },
    { store: 'env', localDir: (paths) => paths.ENV_DIR },
    { store: 'avatars', localDir: (paths) => path.join(paths.TENANT_ROOT, 'avatars') },
];

/**
 * ディレクトリを再帰的に走査する
 * @param {string} dir
 * @param {string} baseDir
 * @yields {string} store 相対パス（POSIX）
 */
function* walkLocalFiles(dir, baseDir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walkLocalFiles(abs, baseDir);
        } else if (entry.isFile()) {
            yield path.relative(baseDir, abs).split(path.sep).join('/');
        }
    }
}

/**
 * ローカル store 内のファイル名一覧（フラット、サブディレクトリは path/to/file 形式）
 * @param {string} storeDir
 * @returns {string[]}
 */
export function listLocalStoreRelativePaths(storeDir) {
    if (!fs.existsSync(storeDir)) return [];
    return [...walkLocalFiles(storeDir, storeDir)].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
}

/**
 * ローカル store のファイル名一覧（直下のみ）
 * @param {string} storeDir
 * @param {(name: string) => boolean} [filter]
 * @returns {string[]}
 */
export function listLocalStoreFilenames(storeDir, filter) {
    if (!fs.existsSync(storeDir)) return [];
    return fs
        .readdirSync(storeDir)
        .filter((name) => {
            const abs = path.join(storeDir, name);
            if (!fs.statSync(abs).isFile()) return false;
            return !filter || filter(name);
        })
        .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}

/**
 * R2 に無い、またはローカルが新しいファイルを R2 へアップロードする
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {string} store
 * @param {{ dryRun?: boolean }} [options]
 */
export async function syncLocalTenantStoreToR2(tenant, store, options = {}) {
    const def = SYNC_STORES.find((s) => s.store === store);
    if (!def) {
        throw new Error(`Unsupported store: ${store}`);
    }

    const localDir = def.localDir(tenant.paths);
    const uploaded = [];
    const skipped = [];
    const errors = [];

    for (const rel of walkLocalFiles(localDir, localDir)) {
        if (!isValidRelativePath(rel)) {
            errors.push({ path: rel, error: 'invalid_path' });
            continue;
        }

        const abs = path.resolve(localDir, rel);
        if (!isPathInsideTenantRoot(tenant.paths.TENANT_ROOT, abs)) {
            errors.push({ path: rel, error: 'forbidden_path' });
            continue;
        }

        let localStat;
        try {
            localStat = fs.statSync(abs);
            if (!localStat.isFile()) continue;
        } catch (e) {
            errors.push({
                path: rel,
                error: e instanceof Error ? e.message : String(e),
            });
            continue;
        }

        const r2Key = toR2Key(tenant.id, store, rel);
        try {
            const head = await headObject(r2Key);
            if (head?.lastModified && head.lastModified.getTime() >= localStat.mtimeMs - 1000) {
                skipped.push(rel);
                continue;
            }
        } catch (e) {
            errors.push({
                path: rel,
                error: e instanceof Error ? e.message : String(e),
            });
            continue;
        }

        if (options.dryRun) {
            uploaded.push(rel);
            continue;
        }

        try {
            const body = fs.readFileSync(abs);
            await putObject(r2Key, body, guessContentType(rel));
            uploaded.push(rel);
        } catch (e) {
            errors.push({
                path: rel,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    return { store, uploaded, skipped, errors };
}

/**
 * テナントの全ストアをローカル → R2 に同期する
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {{ dryRun?: boolean }} [options]
 */
export async function reconcileTenantAssetsToR2(tenant, options = {}) {
    if (!isR2Enabled()) {
        return { tenantId: tenant.id, skipped: true, stores: [] };
    }

    const stores = [];
    for (const { store } of SYNC_STORES) {
        const result = await syncLocalTenantStoreToR2(tenant, store, options);
        stores.push(result);
    }

    const uploaded = stores.reduce((n, s) => n + s.uploaded.length, 0);
    const skipped = stores.reduce((n, s) => n + s.skipped.length, 0);
    const errors = stores.reduce((n, s) => n + s.errors.length, 0);

    return { tenantId: tenant.id, skipped: false, uploaded, skippedCount: skipped, errors, stores };
}

/**
 * 全テナントのローカルアセットを R2 と整合させる
 * @param {import('./tenant-registry.js').TenantRecord[]} tenants
 * @param {{ dryRun?: boolean }} [options]
 */
export async function reconcileAllTenantsAssetsToR2(tenants, options = {}) {
    if (!isR2Enabled()) {
        return { skipped: true, tenants: [] };
    }

    const results = [];
    for (const tenant of tenants) {
        results.push(await reconcileTenantAssetsToR2(tenant, options));
    }
    return { skipped: false, tenants: results };
}

/**
 * R2 またはローカルにアセットが存在するか
 * @param {import('../tenant-registry.js').TenantRecord} tenant
 * @param {string} store
 * @param {string} relativePath
 * @returns {Promise<boolean>}
 */
export async function tenantAssetExists(tenant, store, relativePath) {
    if (isR2Enabled()) {
        try {
            const r2Key = toR2Key(tenant.id, store, relativePath);
            const head = await headObject(r2Key);
            if (head) return true;
        } catch {
            /* fall through to local */
        }
    }

    const localDir = getLocalDirForStore(tenant, store);
    if (!localDir) return false;

    const rel = String(relativePath || '').replace(/^\/+/, '').replace(/\\/g, '/');
    if (!rel || !isValidRelativePath(rel)) return false;

    const filePath = path.join(localDir, rel);
    if (!isPathInsideTenantRoot(tenant.paths.TENANT_ROOT, filePath)) {
        return false;
    }
    return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
}

/**
 * store 名からローカルディレクトリを解決する
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {string} store
 * @returns {string | null}
 */
export function getLocalDirForStore(tenant, store) {
    const def = SYNC_STORES.find((s) => s.store === store);
    if (!def) return null;
    return def.localDir(tenant.paths);
}

/**
 * ローカルと R2 のファイル名を統合する（R2 無効時はローカルのみ）
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {string} store
 * @param {(name: string) => boolean} [filter]
 * @returns {Promise<string[]>}
 */
export async function listMergedTenantStoreFilenames(tenant, store, filter) {
    const localDir = getLocalDirForStore(tenant, store);
    const local = localDir ? listLocalStoreFilenames(localDir, filter) : [];

    if (!isR2Enabled()) {
        return local;
    }

    const { listTenantStoreFilenames } = await import('./r2/tenant-storage.js');
    const remote = await listTenantStoreFilenames(tenant.id, store, filter);
    return [...new Set([...local, ...remote])].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: 'base' })
    );
}
