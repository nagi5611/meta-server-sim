// lib/tenant-plugin-config.js — config.json + DB + env overlay
import fs from 'node:fs';
import path from 'node:path';
import { getTenantPluginConfigMap } from '../db/tenant-plugins-registry.js';

/**
 * @param {string} pluginId
 * @param {string} tenantId
 */
export function tenantPluginEnvPrefix(tenantId, pluginId) {
    const tid = tenantId.replace(/-/g, '_').toUpperCase();
    const pid = pluginId.replace(/-/g, '_').toUpperCase();
    return `TENANT_${tid}_ADDON_${pid}_`;
}

/**
 * @param {string} tenantId
 * @param {string} pluginId
 * @param {string} addonRoot
 * @returns {Record<string, unknown>}
 */
export function loadMergedTenantPluginConfig(tenantId, pluginId, addonRoot) {
    const cfgPath = path.join(addonRoot, 'config.json');
    /** @type {Record<string, unknown>} */
    let base = {};
    if (fs.existsSync(cfgPath)) {
        try {
            base = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
            if (!base || typeof base !== 'object') base = {};
        } catch {
            base = {};
        }
    }

    const dbConfig = getTenantPluginConfigMap(tenantId, pluginId);
    /** @type {Record<string, unknown>} */
    const overlay = { ...base, ...dbConfig };

    const prefix = tenantPluginEnvPrefix(tenantId, pluginId);
    for (const [k, v] of Object.entries(process.env)) {
        if (!k.startsWith(prefix) || v === undefined) continue;
        const shortKey = k.slice(prefix.length).toLowerCase();
        if (!shortKey) continue;
        overlay[shortKey] = v;
    }

    return overlay;
}
