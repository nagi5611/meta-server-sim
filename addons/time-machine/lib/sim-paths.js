// addons/time-machine/lib/sim-paths.js — meta-server-sim backup path helpers
import fs from 'node:fs';
import path from 'node:path';
import { listTenants } from '../../../lib/tenant-registry.js';
import { getTenantStoragePaths } from '../../../lib/tenant-storage-paths.js';

/** Snapshot directory namespace on backup mounts */
export const SNAPSHOT_NAMESPACE = 'meta-server-sim';

/**
 * @returns {string}
 */
export function getRepoRoot() {
    return process.cwd();
}

/**
 * @returns {string | null}
 */
export function getEnvFilePath() {
    const envPath = path.join(getRepoRoot(), '.env');
    return fs.existsSync(envPath) ? envPath : null;
}

/**
 * @returns {string}
 */
export function getSrcDirectory() {
    const raw =
        process.env.METASIM_SRC_DIRECTORY ||
        process.env.META_SRC_DIRECTORY ||
        '';
    if (raw.trim()) return path.resolve(raw.trim());
    return getRepoRoot();
}

/**
 * @returns {string}
 */
export function getPlatformDataDir() {
    return path.join(getRepoRoot(), 'data', 'platform');
}

/**
 * @returns {string}
 */
export function getTenantsRoot() {
    return path.join(getRepoRoot(), 'tenants');
}

/**
 * @returns {string[]}
 */
export function listTenantStateDirs() {
    /** @type {string[]} */
    const dirs = [];
    for (const tenant of listTenants()) {
        const p = getTenantStoragePaths(tenant.paths.TENANT_ROOT);
        if (fs.existsSync(p.DATA_DIR)) dirs.push(p.DATA_DIR);
        if (fs.existsSync(p.DB_DIR)) dirs.push(p.DB_DIR);
    }
    return dirs;
}

/**
 * @returns {string[]}
 */
export function getExplicitStorageRoots() {
    const roots = new Set();
    const add = (p) => {
        if (p && fs.existsSync(p)) roots.add(path.resolve(p));
    };
    add(getPlatformDataDir());
    add(getTenantsRoot());
    for (const d of listTenantStateDirs()) add(d);
    return [...roots];
}
