// addons/time-machine/lib/backup-scopes.js — meta-server-sim backup targets
import fs from 'node:fs';
import path from 'node:path';
import {
    getEnvFilePath,
    getExplicitStorageRoots,
    getPlatformDataDir,
    getRepoRoot,
    getSrcDirectory,
    getTenantsRoot,
    listTenantStateDirs,
} from './sim-paths.js';

/** @typedef {'state' | 'full' | 'addons' | 'server_src'} BackupScope */

const EXCLUDE_DIR_NAMES = new Set(['node_modules', '.git', 'logs', '_archive']);

export { getRepoRoot, getEnvFilePath, getSrcDirectory, getExplicitStorageRoots };

/**
 * @param {string} dir
 * @param {string[]} backupMountRoots
 * @returns {boolean}
 */
export function shouldExcludeDir(dir, backupMountRoots) {
    const base = path.basename(dir);
    if (EXCLUDE_DIR_NAMES.has(base)) return true;
    for (const root of backupMountRoots) {
        const rel = path.relative(root, dir);
        if (rel === 'meta-server-sim' || rel.startsWith(`meta-server-sim${path.sep}`)) {
            return true;
        }
    }
    return false;
}

/**
 * @param {BackupScope} scope
 * @param {string[]} backupMountRoots
 */
export function resolveScopeTargets(scope, backupMountRoots = []) {
    const envFile = getEnvFilePath();
    const envTarget = envFile ? [{ type: 'file', src: envFile, destSub: 'env/.env' }] : [];

    if (scope === 'state') {
        /** @type {Array<{ type: 'dir' | 'file', src: string, destSub: string }>} */
        const targets = [];
        const platformData = getPlatformDataDir();
        if (fs.existsSync(platformData)) {
            targets.push({ type: 'dir', src: platformData, destSub: 'data/platform' });
        }
        const tenantsRoot = getTenantsRoot();
        if (fs.existsSync(tenantsRoot)) {
            targets.push({ type: 'dir', src: tenantsRoot, destSub: 'tenants' });
        }
        return [...targets, ...envTarget];
    }

    if (scope === 'addons') {
        const addonsDir = path.join(getRepoRoot(), 'addons');
        if (!fs.existsSync(addonsDir)) return [...envTarget];
        return [{ type: 'dir', src: addonsDir, destSub: 'addons' }, ...envTarget];
    }

    if (scope === 'server_src' || scope === 'full') {
        const src = getSrcDirectory();
        if (src) {
            return [{ type: 'dir', src, destSub: 'src' }, ...envTarget];
        }
        const roots = getExplicitStorageRoots();
        return [
            ...roots.map((r) => ({
                type: 'dir',
                src: r,
                destSub: `src/${path.basename(r)}`,
            })),
            ...envTarget,
        ];
    }

    return envTarget;
}

/**
 * @param {'hourly' | 'daily'} kind
 * @returns {BackupScope}
 */
export function defaultScopeForKind(kind) {
    return kind === 'hourly' ? 'state' : 'full';
}

/**
 * @param {string} dir
 * @returns {string[]}
 */
export function listSqliteDbFiles(dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    const walk = (d) => {
        for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, ent.name);
            if (ent.isDirectory()) {
                if (!shouldExcludeDir(full, [])) walk(full);
            } else if (ent.isFile() && ent.name.endsWith('.db')) {
                out.push(full);
            }
        }
    };
    walk(dir);
    return out;
}

export { listTenantStateDirs };
