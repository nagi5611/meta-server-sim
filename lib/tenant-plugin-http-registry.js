// lib/tenant-plugin-http-registry.js — plugin HTTP under /api/tenant-plugins/:pluginId
import express from 'express';

/** @type {Map<string, import('express').Router>} */
const pluginRouters = new Map();

/**
 * @param {string} tenantId
 * @param {string} pluginId
 */
function key(tenantId, pluginId) {
    return `${tenantId}:${pluginId}`;
}

/**
 * @param {string} tenantId
 * @param {string} pluginId
 * @param {import('express').Router} router
 */
export function registerTenantPluginHttpRouter(tenantId, pluginId, router) {
    pluginRouters.set(key(tenantId, pluginId), router);
}

/**
 * @param {string} tenantId
 */
export function clearTenantPluginHttpRouters(tenantId) {
    const prefix = `${tenantId}:`;
    for (const k of pluginRouters.keys()) {
        if (k.startsWith(prefix)) pluginRouters.delete(k);
    }
}

/**
 * @param {import('express').Router} tenantRouter
 */
export function attachTenantPluginHttpDispatcher(tenantRouter) {
    const mount = express.Router({ mergeParams: true });
    mount.use('/:pluginId', (req, res, next) => {
        const tenantId = req.tenant?.id;
        const pluginId = String(req.params.pluginId || '').trim();
        if (!tenantId || !pluginId) {
            return res.status(400).json({ error: 'bad_request' });
        }
        const sub = pluginRouters.get(key(tenantId, pluginId));
        if (!sub) {
            return res.status(404).json({ error: 'plugin_not_loaded' });
        }
        return sub(req, res, next);
    });
    tenantRouter.use('/api/tenant-plugins', mount);
}
