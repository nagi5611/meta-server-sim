// lib/tenant-plugin-runtime.js — lazy load, reload, public enabled payloads
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    initTenantPluginsRegistryDb,
    isTenantPluginEnabled,
    setTenantPluginEnabled,
} from '../db/tenant-plugins-registry.js';
import { getHookRegistry, HOOKS } from './hook-registry.js';
import { discoverPlatformPlugins, discoverPluginsForTenant, findPluginForTenant } from './tenant-plugin-catalog.js';
import { loadEnabledTenantPlugins, validatePluginForEnable } from './tenant-plugin-loader.js';
import { clearTenantPluginHttpRouters } from './tenant-plugin-http-registry.js';
import { getTenantIoServer } from './tenant-socket.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** @type {Map<string, { loadedAt: number, report: import('./tenant-plugin-loader.js').TenantPluginLoadReport[] }>} */
const tenantLoadCache = new Map();

function readCoreVersion() {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return String(pkg.version || '0.0.0');
}

let coreVersionCache = '';

export function getSimCoreVersion() {
    if (!coreVersionCache) coreVersionCache = readCoreVersion();
    return coreVersionCache;
}

/** @type {import('express').Router | null} */
let sharedTenantRouterRef = null;

export function setSharedTenantRouter(router) {
    sharedTenantRouterRef = router;
}

export function getSharedTenantRouter() {
    return sharedTenantRouterRef;
}

export function initTenantPluginsPlatform() {
    initTenantPluginsRegistryDb();
    const catalog = discoverPlatformPlugins();
    console.log(
        `[tenant-plugins] platform catalog: ${catalog.length} addon(s) [${catalog.map((c) => c.id).join(', ') || 'none'}]`
    );
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {import('express').Router} tenantRouter
 */
export async function ensureTenantPluginsLoaded(tenant, tenantRouter) {
    if (tenantLoadCache.has(tenant.id)) {
        return tenantLoadCache.get(tenant.id).report;
    }

    const hooks = getHookRegistry();
    const io = getTenantIoServer(tenant.id) ?? null;

    await hooks.emitAsync(HOOKS.SERVER_TENANT_INIT, {
        tenantId: tenant.id,
        tenant,
        tenantRouter,
        io,
    });

    const catalog = discoverPluginsForTenant(tenant);
    const report = await loadEnabledTenantPlugins({
        tenant,
        tenantRouter,
        io,
        coreVersion: getSimCoreVersion(),
        catalog,
    });

    const loaded = report.filter((r) => r.loaded).length;
    console.log(
        `[tenant-plugins] ${tenant.id}: ${loaded}/${report.length} plugin(s) loaded`
    );

    tenantLoadCache.set(tenant.id, { loadedAt: Date.now(), report });
    return report;
}

/**
 * @param {string} tenantId
 */
export function invalidateTenantPluginCache(tenantId) {
    tenantLoadCache.delete(String(tenantId || '').trim());
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {import('express').Router} tenantRouter
 */
export async function reloadTenantPlugins(tenant, tenantRouter) {
    clearTenantPluginHttpRouters(tenant.id);
    invalidateTenantPluginCache(tenant.id);
    return ensureTenantPluginsLoaded(tenant, tenantRouter);
}

/**
 * Legacy shape for /api/addons/enabled — empty object when none; otherwise id -> true
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 */
export function getLegacyAddonsEnabledMap(tenant) {
    const catalog = discoverPluginsForTenant(tenant);
    /** @type {Record<string, boolean>} */
    const out = {};
    for (const entry of catalog) {
        if (isTenantPluginEnabled(tenant.id, entry.id)) {
            out[entry.id] = true;
        }
    }
    return out;
}

/**
 * Public client payload
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 */
export function getPublicTenantAddonsEnabled(tenant) {
    const catalog = discoverPluginsForTenant(tenant);
    /** @type {Array<{ id: string, version: string, gameModule?: string, adminModule?: string }>} */
    const plugins = [];
    for (const entry of catalog) {
        if (!isTenantPluginEnabled(tenant.id, entry.id)) continue;
        plugins.push({
            id: entry.id,
            version: entry.manifest.version,
            gameModule: entry.manifest.client?.game,
            adminModule: entry.manifest.client?.admin,
        });
    }
    return { tenantId: tenant.id, plugins };
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {string} pluginId
 */
export function validatePluginEnableRequest(tenant, pluginId) {
    const discovered = findPluginForTenant(tenant, pluginId);
    if (!discovered) {
        return { ok: false, errors: [`unknown plugin: ${pluginId}`] };
    }
    return validatePluginForEnable(tenant, discovered, getSimCoreVersion());
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {string} pluginId
 * @param {boolean} enabled
 */
export function setTenantPluginEnabledWithValidation(tenant, pluginId, enabled) {
    if (enabled) {
        const v = validatePluginEnableRequest(tenant, pluginId);
        if (!v.ok) return v;
    }
    setTenantPluginEnabled(tenant.id, pluginId, enabled);
    invalidateTenantPluginCache(tenant.id);
    return { ok: true };
}

/**
 * Middleware: lazy-load plugins on first tenant API hit
 * @param {import('express').Router} tenantRouter
 */
export function registerTenantPluginLazyMiddleware(tenantRouter) {
    tenantRouter.use(async (req, res, next) => {
        try {
            if (!req.tenant) return next();
            const p = String(req.path || '');
            if (!p.startsWith('/api') && !p.startsWith('/addons-client')) return next();
            await ensureTenantPluginsLoaded(req.tenant, tenantRouter);
            return next();
        } catch (e) {
            console.error(`[tenant-plugins] load failed for ${req.tenant?.id}:`, e);
            return next(e);
        }
    });
}

export function registerTenantPluginShutdownHooks(httpServer) {
    const hooks = getHookRegistry();
    httpServer.on('close', () => {
        hooks.emitAsync(HOOKS.SHUTDOWN, { httpServer }).catch((e) => {
            console.error('[tenant-plugins] shutdown hook error:', e);
        });
    });
}

export function listTenantPluginsForAdmin(tenant) {
    const enabledMap = new Map();
    const catalog = discoverPluginsForTenant(tenant);
    for (const entry of catalog) {
        enabledMap.set(entry.id, isTenantPluginEnabled(tenant.id, entry.id));
    }
    return catalog.map((entry) => ({
        id: entry.id,
        version: entry.manifest.version,
        scope: entry.manifest.scope || 'platform',
        source: entry.source,
        enabled: enabledMap.get(entry.id) === true,
        publicHost: entry.manifest.client?.game ? entry.manifest.client.game : undefined,
        addonRoot: entry.addonRoot,
    }));
}
