// lib/tenant-plugin-loader.js — dynamic import + register per tenant
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import semver from 'semver';
import express from 'express';
import { isTenantPluginEnabled } from '../db/tenant-plugins-registry.js';
import { getHookRegistry, HOOKS, createTenantPluginHookScope } from './hook-registry.js';
import { loadMergedTenantPluginConfig } from './tenant-plugin-config.js';
import { runTenantPluginMigrations } from './tenant-plugin-migrations.js';
import { registerTenantPluginHttpRouter } from './tenant-plugin-http-registry.js';
import {
    checkTenantAllowlist,
    readTenantPluginManifest,
} from './tenant-plugin-manifest.js';

/**
 * @param {string} coreVersion
 * @param {import('./tenant-plugin-manifest.js').TenantPluginManifest} manifest
 */
export function checkSimEngineRange(coreVersion, manifest) {
    const range = manifest.engines?.['meta-server-sim'];
    if (!range || typeof range !== 'string') {
        return { ok: false, reason: 'missing engines.meta-server-sim' };
    }
    try {
        if (semver.satisfies(coreVersion, range, { includePrerelease: true })) {
            return { ok: true };
        }
        return { ok: false, reason: `core ${coreVersion} does not satisfy ${range}` };
    } catch (e) {
        return { ok: false, reason: `invalid semver range: ${e instanceof Error ? e.message : e}` };
    }
}

/**
 * @param {string} pluginId
 */
function createPluginLogger(pluginId, tenantId) {
    const p = `[tenant-plugin:${tenantId}:${pluginId}]`;
    return {
        info: (...args) => console.log(p, ...args),
        warn: (...args) => console.warn(p, ...args),
        error: (...args) => console.error(p, ...args),
    };
}

/**
 * Validate manifest before enable (admin)
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {import('./tenant-plugin-catalog.js').DiscoveredPlugin} discovered
 * @param {string} coreVersion
 */
export function validatePluginForEnable(tenant, discovered, coreVersion) {
    const manifestResult = readTenantPluginManifest(discovered.addonRoot);
    if (!manifestResult.ok) {
        return { ok: false, errors: manifestResult.errors };
    }
    const { manifest } = manifestResult;
    if (manifest.id !== discovered.id) {
        return { ok: false, errors: ['manifest id mismatch'] };
    }
    const eng = checkSimEngineRange(coreVersion, manifest);
    if (!eng.ok) return { ok: false, errors: [eng.reason || 'engine mismatch'] };
    const allow = checkTenantAllowlist(manifest, tenant.id);
    if (!allow.ok) return { ok: false, errors: [allow.reason || 'tenant not allowed'] };
    return { ok: true, manifest };
}

/**
 * @typedef {object} TenantPluginLoadReport
 * @property {string} id
 * @property {string} version
 * @property {boolean} loaded
 * @property {string} [skipReason]
 */

/**
 * @param {object} opts
 * @param {import('./tenant-registry.js').TenantRecord} opts.tenant
 * @param {import('express').Router} opts.tenantRouter
 * @param {import('socket.io').Server | null} opts.io
 * @param {string} opts.coreVersion
 * @param {import('./tenant-plugin-catalog.js').DiscoveredPlugin[]} opts.catalog
 */
export async function loadEnabledTenantPlugins(opts) {
    const { tenant, tenantRouter, io, coreVersion, catalog } = opts;
    const hooks = getHookRegistry();
    /** @type {TenantPluginLoadReport[]} */
    const report = [];

    for (const entry of catalog) {
        const { manifest, addonRoot, id } = entry;
        if (!isTenantPluginEnabled(tenant.id, id)) {
            report.push({
                id,
                version: manifest.version,
                loaded: false,
                skipReason: 'disabled',
            });
            continue;
        }

        const eng = checkSimEngineRange(coreVersion, manifest);
        if (!eng.ok) {
            report.push({
                id,
                version: manifest.version,
                loaded: false,
                skipReason: eng.reason,
            });
            continue;
        }

        const allow = checkTenantAllowlist(manifest, tenant.id);
        if (!allow.ok) {
            report.push({
                id,
                version: manifest.version,
                loaded: false,
                skipReason: allow.reason,
            });
            continue;
        }

        const engineMainUrl = pathToFileURL(path.join(addonRoot, manifest.main)).href;

        try {
            const mod = await import(engineMainUrl);
            const plugin = mod.default;
            if (!plugin || typeof plugin.register !== 'function') {
                throw new Error('default export must have register(context)');
            }

            const pluginDbPath = path.join(tenant.paths.DB_DIR, 'plugins', `${id}.db`);
            const migrationsRel = manifest.migrationsDir || 'migrations';
            const migrationsDir = path.join(addonRoot, migrationsRel);
            const httpBasePath = `/api/tenant-plugins/${id}`;

            /** @type {import('better-sqlite3').Database | null} */
            let dbInstance = null;

            const ctx = {
                tenantId: tenant.id,
                tenant,
                pluginId: id,
                manifest,
                config: loadMergedTenantPluginConfig(tenant.id, id, addonRoot),
                logger: createPluginLogger(id, tenant.id),
                hooks: createTenantPluginHookScope(hooks, tenant.id, id),
                paths: {
                    addonRoot,
                    pluginDbPath,
                    httpBasePath,
                },
                coreVersion,
                getIo: () => io,
                mountHttp: (configure) => {
                    const sub = express.Router({ mergeParams: true });
                    configure(sub);
                    registerTenantPluginHttpRouter(tenant.id, id, sub);
                },
                openDatabase: () => {
                    if (!dbInstance) {
                        const parent = path.dirname(pluginDbPath);
                        if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
                        dbInstance = new Database(pluginDbPath);
                        runTenantPluginMigrations(dbInstance, migrationsDir);
                    }
                    return dbInstance;
                },
                registerPlatformAdmin: () => {
                    /* platform routes mounted via syncPlatformAdminPluginRoutes */
                },
            };

            await plugin.register(ctx);
            report.push({ id, version: manifest.version, loaded: true });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.error(`[tenant-plugin] failed ${tenant.id}/${id}:`, msg);
            report.push({
                id,
                version: manifest.version,
                loaded: false,
                skipReason: msg,
            });
        }
    }

    await hooks.emitAsync(HOOKS.AFTER_TENANT_ROUTES_MOUNTED, {
        tenantId: tenant.id,
        tenant,
        tenantRouter,
        io,
    });

    return report;
}

export { HOOKS };
