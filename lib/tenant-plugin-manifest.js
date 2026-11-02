// lib/tenant-plugin-manifest.js — plugin.json for meta-server-sim
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {object} TenantPluginManifest
 * @property {string} id
 * @property {string} version
 * @property {string} main
 * @property {{ 'meta-server-sim': string }} engines
 * @property {'platform' | 'tenant' | 'both'} [scope]
 * @property {string[]} [tenantIds]
 * @property {{ admin?: string, game?: string }} [client]
 * @property {string} [migrationsDir]
 */

/**
 * @param {unknown} v
 * @returns {string[]}
 */
function readErrors(v) {
    const errs = [];
    if (!v || typeof v !== 'object') {
        errs.push('manifest must be an object');
        return errs;
    }
    const m = /** @type {Record<string, unknown>} */ (v);
    if (!m.id || typeof m.id !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(m.id)) {
        errs.push('id must be kebab-case');
    }
    if (!m.version || typeof m.version !== 'string') {
        errs.push('version required (semver)');
    }
    if (!m.main || typeof m.main !== 'string') {
        errs.push('main entry path required');
    }
    const eng = m.engines;
    if (!eng || typeof eng !== 'object' || !('meta-server-sim' in eng)) {
        errs.push('engines.meta-server-sim semver range required');
    } else {
        const r = /** @type {Record<string, unknown>} */ (eng)['meta-server-sim'];
        if (typeof r !== 'string' || !r.trim()) errs.push('engines.meta-server-sim must be non-empty');
    }
    if (m.scope != null) {
        const s = String(m.scope);
        if (!['platform', 'tenant', 'both'].includes(s)) {
            errs.push('scope must be platform, tenant, or both');
        }
    }
    if (m.tenantIds != null) {
        if (!Array.isArray(m.tenantIds) || m.tenantIds.some((x) => typeof x !== 'string')) {
            errs.push('tenantIds must be string array');
        }
    }
    return errs;
}

/**
 * @param {string} addonRoot
 * @returns {{ ok: true, manifest: TenantPluginManifest, manifestPath: string } | { ok: false, errors: string[] }}
 */
export function readTenantPluginManifest(addonRoot) {
    const manifestPath = path.join(addonRoot, 'plugin.json');
    if (!fs.existsSync(manifestPath)) {
        return { ok: false, errors: ['plugin.json not found'] };
    }
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
        return { ok: false, errors: [`invalid JSON: ${e instanceof Error ? e.message : String(e)}`] };
    }
    const errors = readErrors(raw);
    if (errors.length) return { ok: false, errors };

    const manifest = /** @type {TenantPluginManifest} */ (raw);
    const mainAbs = path.join(addonRoot, manifest.main);
    if (!fs.existsSync(mainAbs)) {
        return { ok: false, errors: [`main file missing: ${manifest.main}`] };
    }
    if (manifest.client?.game) {
        const gameAbs = path.join(addonRoot, manifest.client.game);
        if (!fs.existsSync(gameAbs)) {
            return { ok: false, errors: [`client.game missing: ${manifest.client.game}`] };
        }
    }
    return { ok: true, manifest, manifestPath };
}

/**
 * @param {TenantPluginManifest} manifest
 * @param {string} tenantId
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkTenantAllowlist(manifest, tenantId) {
    if (!manifest.tenantIds?.length) return { ok: true };
    if (manifest.tenantIds.includes(tenantId)) return { ok: true };
    return { ok: false, reason: `tenant ${tenantId} not in manifest tenantIds allowlist` };
}
