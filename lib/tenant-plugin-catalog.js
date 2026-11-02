// lib/tenant-plugin-catalog.js — discover platform + tenant addon directories
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTenantPluginManifest } from './tenant-plugin-manifest.js';
import { isPathInsideTenantRoot } from './tenant-storage-paths.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');

/**
 * @typedef {object} DiscoveredPlugin
 * @property {string} id
 * @property {string} addonRoot
 * @property {'platform' | 'tenant'} source
 * @property {import('./tenant-plugin-manifest.js').TenantPluginManifest} manifest
 */

export function getPlatformAddonsRoot() {
    return path.join(PROJECT_ROOT, 'addons');
}

/**
 * @param {string} tenantRoot
 */
export function getTenantAddonsRoot(tenantRoot) {
    return path.join(tenantRoot, 'addons');
}

/**
 * @param {string} addonsRoot
 * @returns {string[]}
 */
function listAddonDirNames(addonsRoot) {
    if (!fs.existsSync(addonsRoot)) return [];
    return fs
        .readdirSync(addonsRoot, { withFileTypes: true })
        .filter((e) => e.isDirectory() && !e.name.startsWith('.'))
        .map((e) => e.name);
}

/**
 * @param {string} addonsRoot
 * @param {'platform' | 'tenant'} source
 * @returns {DiscoveredPlugin[]}
 */
function discoverInRoot(addonsRoot, source) {
    /** @type {DiscoveredPlugin[]} */
    const out = [];
    for (const dirName of listAddonDirNames(addonsRoot)) {
        const addonRoot = path.join(addonsRoot, dirName);
        const manifestResult = readTenantPluginManifest(addonRoot);
        if (!manifestResult.ok) continue;
        const { manifest } = manifestResult;
        if (manifest.id !== dirName) continue;
        const scope = manifest.scope || 'platform';
        if (source === 'platform' && scope === 'tenant') continue;
        if (source === 'tenant' && scope === 'platform') continue;
        out.push({ id: manifest.id, addonRoot, source, manifest });
    }
    return out;
}

/**
 * Platform catalog only (startup scan)
 * @returns {DiscoveredPlugin[]}
 */
export function discoverPlatformPlugins() {
    return discoverInRoot(getPlatformAddonsRoot(), 'platform');
}

/**
 * Merged catalog for a tenant (platform + tenant-local)
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 */
export function discoverPluginsForTenant(tenant) {
    const platform = discoverInRoot(getPlatformAddonsRoot(), 'platform');
    const tenantRoot = tenant.paths.TENANT_ROOT;
    const tenantAddonsRoot = getTenantAddonsRoot(tenantRoot);
    if (!isPathInsideTenantRoot(tenantRoot, tenantAddonsRoot)) {
        return platform;
    }
    const local = discoverInRoot(tenantAddonsRoot, 'tenant');
    const byId = new Map(platform.map((p) => [p.id, p]));
    for (const p of local) {
        byId.set(p.id, p);
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * @param {string} pluginId
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @returns {DiscoveredPlugin | undefined}
 */
export function findPluginForTenant(tenant, pluginId) {
    return discoverPluginsForTenant(tenant).find((p) => p.id === pluginId);
}
