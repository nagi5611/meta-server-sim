// lib/tenant-plugin-platform-admin.js — global /admin/addons/* from enabled tenant plugins
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';
import express from 'express';
import { isTenantPluginEnabled } from '../db/tenant-plugins-registry.js';
import { listTenants } from './tenant-registry.js';
import { discoverPluginsForTenant } from './tenant-plugin-catalog.js';
import {
    checkSimEngineRange,
} from './tenant-plugin-loader.js';
import { getSimCoreVersion } from './tenant-plugin-runtime.js';
import { loadMergedTenantPluginConfig } from './tenant-plugin-config.js';
import { runTenantPluginMigrations } from './tenant-plugin-migrations.js';
import { getHookRegistry, createTenantPluginHookScope } from './hook-registry.js';
import { checkTenantAllowlist } from './tenant-plugin-manifest.js';
import { getTenantIoServer } from './tenant-socket.js';

/** @typedef {import('express').RequestHandler} RequestHandler */

/**
 * @typedef {object} PlatformAdminGuards
 * @property {RequestHandler} basicAuth
 * @property {RequestHandler} adminRateLimit
 * @property {RequestHandler} adminCsrfProtection
 */

/** @type {Set<string>} */
const registeredPlatformAdminPluginIds = new Set();

/** @type {import('express').Express | null} */
let platformAdminApp = null;

/** @type {PlatformAdminGuards | null} */
let platformAdminGuardsRef = null;

/**
 * @param {import('express').Express} app
 * @param {PlatformAdminGuards} guards
 */
export function setPlatformAdminSyncContext(app, guards) {
    platformAdminApp = app;
    platformAdminGuardsRef = guards;
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
 * @param {import('./tenant-plugin-catalog.js').DiscoveredPlugin} entry
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {import('express').Express} app
 * @param {PlatformAdminGuards} guards
 */
async function registerOnePluginPlatformAdmin(entry, tenant, app, guards) {
    const { manifest, addonRoot, id } = entry;
    const engineMainUrl = pathToFileURL(path.join(addonRoot, manifest.main)).href;
    const mod = await import(engineMainUrl);
    const plugin = mod.default;
    if (!plugin || typeof plugin.register !== 'function') {
        throw new Error('default export must have register(context)');
    }

    const pluginDbPath = path.join(tenant.paths.DB_DIR, 'plugins', `${id}.db`);
    const migrationsRel = manifest.migrationsDir || 'migrations';
    const migrationsDir = path.join(addonRoot, migrationsRel);
    const httpBasePath = `/api/tenant-plugins/${id}`;
    const hooks = getHookRegistry();
    const io = getTenantIoServer(tenant.id) ?? null;

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
        coreVersion: getSimCoreVersion(),
        getIo: () => io,
        mountHttp: () => {
            ctx.logger.warn('mountHttp ignored during platform-admin-only registration');
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
        registerPlatformAdmin: (registerFn) => {
            if (typeof registerFn !== 'function') return;
            registerFn(app, guards);
        },
    };

    await plugin.register(ctx);
}

/**
 * Mount /admin/addons/* routes for each globally enabled plugin (once per plugin id).
 * @param {import('express').Express} app
 * @param {PlatformAdminGuards} guards
 */
export async function syncPlatformAdminPluginRoutes(app, guards) {
    setPlatformAdminSyncContext(app, guards);
    registeredPlatformAdminPluginIds.clear();
    const coreVersion = getSimCoreVersion();

    for (const tenant of listTenants()) {
        const catalog = discoverPluginsForTenant(tenant);
        for (const entry of catalog) {
            const { id } = entry;
            if (registeredPlatformAdminPluginIds.has(id)) continue;
            if (!isTenantPluginEnabled(tenant.id, id)) continue;

            const eng = checkSimEngineRange(coreVersion, entry.manifest);
            if (!eng.ok) continue;
            const allow = checkTenantAllowlist(entry.manifest, tenant.id);
            if (!allow.ok) continue;

            try {
                await registerOnePluginPlatformAdmin(entry, tenant, app, guards);
                registeredPlatformAdminPluginIds.add(id);
                console.log(
                    `[tenant-plugins] platform admin routes registered for ${id} (via tenant ${tenant.id})`
                );
            } catch (e) {
                console.error(
                    `[tenant-plugins] platform admin registration failed ${id}:`,
                    e instanceof Error ? e.message : e
                );
            }
        }
    }
}

/**
 * Re-sync after plugin enable/disable/reload.
 * @param {import('express').Express} app
 * @param {PlatformAdminGuards} guards
 */
export async function refreshPlatformAdminPluginRoutes(app, guards) {
    await syncPlatformAdminPluginRoutes(app, guards);
}

/**
 * Re-sync using last registerPlatformAdmin context (after plugin reload).
 */
export async function refreshPlatformAdminPluginRoutesFromContext() {
    if (!platformAdminApp || !platformAdminGuardsRef) return;
    await syncPlatformAdminPluginRoutes(platformAdminApp, platformAdminGuardsRef);
}
