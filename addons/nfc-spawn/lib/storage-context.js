// addons/nfc-spawn/lib/storage-context.js — テナントごとのストレージパス（register 時に設定）

/** @type {import('../../../lib/tenant-storage-paths.js').ReturnType<import('../../../lib/tenant-storage-paths.js').getTenantStoragePaths>> | null} */
let tenantPaths = null;

/**
 * @param {ReturnType<import('../../../lib/tenant-storage-paths.js').getTenantStoragePaths>} paths
 */
export function setNfcSpawnTenantPaths(paths) {
    tenantPaths = paths;
}

/**
 * @returns {NonNullable<typeof tenantPaths>}
 */
export function getNfcSpawnTenantPaths() {
    if (!tenantPaths) {
        throw new Error('nfc-spawn tenant paths not configured');
    }
    return tenantPaths;
}