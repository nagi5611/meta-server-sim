// lib/platform-admin-mcp-ops.js — 管理パネル「追加編集点」（env-config / tenant plugins）を MCP と共有
import 'dotenv/config';
import { initTenantPluginsRegistryDb } from '../db/tenant-plugins-registry.js';
import {
    getEnvConfigForAdmin,
    saveEnvConfigFromAdmin,
    reloadEnvConfig,
} from './platform-env-config.js';
import { getTenant } from './tenant-registry.js';
import { loadTenantRegistry } from './tenant-registry.js';
import {
    getTenantPluginConfigMap,
    setTenantPluginConfigBulk,
} from '../db/tenant-plugins-registry.js';
import {
    listTenantPluginsForAdmin,
    setTenantPluginEnabledWithValidation,
} from './tenant-plugin-runtime.js';

let bootstrapped = false;

export function ensurePlatformAdminMcpBootstrap() {
    if (bootstrapped) return;
    initTenantPluginsRegistryDb();
    loadTenantRegistry();
    bootstrapped = true;
}

/**
 * env-config.json + スキーマ上の編集可能キー（管理画面と同じ）
 */
export function platformEnvConfigGetForMcp() {
    ensurePlatformAdminMcpBootstrap();
    const view = getEnvConfigForAdmin();
    /** @type {Record<string, { value: string, locked: boolean, envOnly: boolean, restartRequired: boolean }>} */
    const editable = {};
    for (const group of view.groups || []) {
        for (const item of group.items || []) {
            if (item.envOnly || item.masked) continue;
            editable[item.key] = {
                value: item.locked ? '' : String(item.value ?? ''),
                locked: !!item.locked,
                envOnly: !!item.envOnly,
                restartRequired: !!item.restartRequired,
            };
        }
    }
    return {
        configPath: view.configPath,
        configExists: view.configExists,
        editableKeys: Object.keys(editable),
        values: editable,
    };
}

/**
 * @param {Record<string, string>} updates
 */
export function platformEnvConfigSetForMcp(updates) {
    ensurePlatformAdminMcpBootstrap();
    const saved = saveEnvConfigFromAdmin(updates);
    if (!saved.ok) {
        throw new Error(saved.errors.join('; '));
    }
    reloadEnvConfig();
    return {
        ok: true,
        changedKeys: saved.changedKeys ?? [],
        requiresRestart: saved.requiresRestart ?? [],
    };
}

/**
 * @param {string} tenantId
 */
export function tenantPluginsListForMcp(tenantId) {
    ensurePlatformAdminMcpBootstrap();
    const tenant = getTenant(String(tenantId || '').trim());
    if (!tenant) throw new Error(`tenant not found: ${tenantId}`);
    return {
        tenantId: tenant.id,
        plugins: listTenantPluginsForAdmin(tenant),
    };
}

/**
 * @param {string} tenantId
 * @param {string} pluginId
 * @param {boolean} enabled
 */
export function tenantPluginSetEnabledForMcp(tenantId, pluginId, enabled) {
    ensurePlatformAdminMcpBootstrap();
    const tenant = getTenant(String(tenantId || '').trim());
    if (!tenant) throw new Error(`tenant not found: ${tenantId}`);
    const result = setTenantPluginEnabledWithValidation(tenant, String(pluginId || '').trim(), enabled);
    if (!result.ok) {
        throw new Error(result.errors?.join('; ') || 'enable/disable failed');
    }
    return {
        tenantId: tenant.id,
        pluginId,
        enabled: !!enabled,
        restartRequired: true,
        note: 'POST tenant plugin reload or restart metasim-server to apply server hooks.',
    };
}

/**
 * @param {string} tenantId
 * @param {string} pluginId
 */
export function tenantPluginConfigGetForMcp(tenantId, pluginId) {
    ensurePlatformAdminMcpBootstrap();
    const tenant = getTenant(String(tenantId || '').trim());
    if (!tenant) throw new Error(`tenant not found: ${tenantId}`);
    const pid = String(pluginId || '').trim();
    return {
        tenantId: tenant.id,
        pluginId: pid,
        values: getTenantPluginConfigMap(tenant.id, pid),
    };
}

/**
 * @param {string} tenantId
 * @param {string} pluginId
 * @param {Record<string, string>} updates
 */
export function tenantPluginConfigSetForMcp(tenantId, pluginId, updates) {
    ensurePlatformAdminMcpBootstrap();
    const tenant = getTenant(String(tenantId || '').trim());
    if (!tenant) throw new Error(`tenant not found: ${tenantId}`);
    const pid = String(pluginId || '').trim();
    /** @type {Record<string, string>} */
    const normalized = {};
    for (const [k, v] of Object.entries(updates ?? {})) {
        normalized[String(k)] = String(v ?? '');
    }
    setTenantPluginConfigBulk(tenant.id, pid, normalized);
    return {
        tenantId: tenant.id,
        pluginId: pid,
        updatedKeys: Object.keys(normalized),
        restartRequired: true,
    };
}
