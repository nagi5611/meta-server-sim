// lib/tenant-storage-paths.js
import path from 'node:path';
import fs from 'node:fs';

/**
 * tenant ルートからストレージパスを生成する（metaverse-simple の storage-paths 縮小版）
 * @param {string} tenantRoot 絶対パス tenants/P-01
 * @returns {{
 *   TENANT_ROOT: string,
 *   DATA_DIR: string,
 *   MODELS_DIR: string,
 *   PDFS_DIR: string,
 *   IMAGES_DIR: string,
 *   ENV_DIR: string,
 *   WORLDS_PATH: string,
 *   SIMULATIONS_DIR: string,
 *   DB_DIR: string,
 *   DB_PATH: string,
 * }}
 */
export function getTenantStoragePaths(tenantRoot) {
    const root = path.resolve(tenantRoot);
    const dataDir = path.join(root, 'data');
    const dbDir = path.join(root, 'db');
    return {
        TENANT_ROOT: root,
        DATA_DIR: dataDir,
        MODELS_DIR: path.join(root, 'models'),
        PDFS_DIR: path.join(root, 'pdfs'),
        IMAGES_DIR: path.join(root, 'images'),
        ENV_DIR: path.join(root, 'env'),
        WORLDS_PATH: path.join(dataDir, 'worlds.json'),
        SIMULATIONS_DIR: path.join(dataDir, 'simulations'),
        DB_DIR: dbDir,
        DB_PATH: path.join(dbDir, 'users.db'),
    };
}

/**
 * tenant 配下の必要ディレクトリを作成する
 * @param {ReturnType<typeof getTenantStoragePaths>} paths
 */
export function ensureTenantDirectories(paths) {
    for (const dir of [
        paths.DATA_DIR,
        paths.SIMULATIONS_DIR,
        paths.MODELS_DIR,
        paths.PDFS_DIR,
        paths.IMAGES_DIR,
        paths.ENV_DIR,
        paths.DB_DIR,
    ]) {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    }
}

/**
 * 相対パスが tenant ルート内に留まるか検証
 * @param {string} tenantRoot
 * @param {string} candidatePath
 * @returns {boolean}
 */
export function isPathInsideTenantRoot(tenantRoot, candidatePath) {
    const root = path.resolve(tenantRoot);
    const resolved = path.resolve(candidatePath);
    const rel = path.relative(root, resolved);
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
