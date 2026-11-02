// db/tenant-plugins-registry.js — per-tenant plugin enable/config (platform SQLite)
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_DIR = path.join(__dirname, '..', 'data', 'platform');
const REGISTRY_PATH = path.join(PLATFORM_DIR, 'tenant_plugins.db');

/** @type {import('better-sqlite3').Database | null} */
let db = null;

export function initTenantPluginsRegistryDb() {
    if (db) return db;
    fs.mkdirSync(PLATFORM_DIR, { recursive: true });
    db = new Database(REGISTRY_PATH);
    db.exec(`
        CREATE TABLE IF NOT EXISTS tenant_plugin_enabled (
            tenant_id TEXT NOT NULL,
            plugin_id TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            PRIMARY KEY (tenant_id, plugin_id)
        );
        CREATE TABLE IF NOT EXISTS tenant_plugin_config_kv (
            tenant_id TEXT NOT NULL,
            plugin_id TEXT NOT NULL,
            config_key TEXT NOT NULL,
            config_value TEXT NOT NULL,
            updated_at INTEGER NOT NULL DEFAULT (strftime('%s','now')),
            PRIMARY KEY (tenant_id, plugin_id, config_key)
        );
    `);
    return db;
}

/**
 * @param {string} tenantId
 * @param {string} pluginId
 */
export function isTenantPluginEnabled(tenantId, pluginId) {
    initTenantPluginsRegistryDb();
    const row = db
        .prepare('SELECT enabled FROM tenant_plugin_enabled WHERE tenant_id = ? AND plugin_id = ?')
        .get(tenantId, pluginId);
    if (!row) return false;
    return row.enabled === 1;
}

/**
 * @param {string} tenantId
 * @returns {Map<string, boolean>}
 */
export function getTenantPluginEnabledMap(tenantId) {
    initTenantPluginsRegistryDb();
    const rows = db
        .prepare('SELECT plugin_id, enabled FROM tenant_plugin_enabled WHERE tenant_id = ?')
        .all(tenantId);
    const m = new Map();
    for (const row of rows) {
        m.set(row.plugin_id, row.enabled === 1);
    }
    return m;
}

/**
 * @param {string} tenantId
 * @param {string} pluginId
 * @param {boolean} enabled
 */
export function setTenantPluginEnabled(tenantId, pluginId, enabled) {
    initTenantPluginsRegistryDb();
    db.prepare(
        `INSERT INTO tenant_plugin_enabled (tenant_id, plugin_id, enabled, updated_at)
         VALUES (?, ?, ?, strftime('%s','now'))
         ON CONFLICT(tenant_id, plugin_id) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`
    ).run(tenantId, pluginId, enabled ? 1 : 0);
}

/**
 * @param {string} tenantId
 * @param {string} pluginId
 * @returns {Record<string, string>}
 */
export function getTenantPluginConfigMap(tenantId, pluginId) {
    initTenantPluginsRegistryDb();
    const rows = db
        .prepare(
            `SELECT config_key, config_value FROM tenant_plugin_config_kv
             WHERE tenant_id = ? AND plugin_id = ? ORDER BY config_key ASC`
        )
        .all(tenantId, pluginId);
    /** @type {Record<string, string>} */
    const map = {};
    for (const row of rows) {
        map[row.config_key] = row.config_value;
    }
    return map;
}

/**
 * @param {string} tenantId
 * @param {string} pluginId
 * @param {string} key
 * @param {string} value
 */
export function setTenantPluginConfigValue(tenantId, pluginId, key, value) {
    initTenantPluginsRegistryDb();
    db.prepare(
        `INSERT INTO tenant_plugin_config_kv (tenant_id, plugin_id, config_key, config_value, updated_at)
         VALUES (?, ?, ?, ?, strftime('%s','now'))
         ON CONFLICT(tenant_id, plugin_id, config_key) DO UPDATE SET
           config_value = excluded.config_value,
           updated_at = excluded.updated_at`
    ).run(tenantId, pluginId, key, value);
}

/**
 * @param {string} tenantId
 * @param {string} pluginId
 * @param {Record<string, string>} updates
 */
export function setTenantPluginConfigBulk(tenantId, pluginId, updates) {
    for (const [key, value] of Object.entries(updates)) {
        setTenantPluginConfigValue(tenantId, pluginId, String(key), String(value ?? ''));
    }
}
