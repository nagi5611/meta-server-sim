#!/usr/bin/env node
// scripts/enable-tenant-plugins.mjs — meta-server 移行テナント向け tenant_plugins.db 有効化（idempotent）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_DB = path.join(PROJECT_ROOT, 'data', 'platform', 'tenant_plugins.db');

/** @typedef {{ pluginId: string, enabled: boolean, metaLegacyId?: string, note?: string }} MetaServerPluginRow */

export const META_SERVER_TENANT_ID = 'meta-server';

/**
 * meta-server 本番 registry に対応する sim プラグイン一覧（admin-reboot / nfc-spawn は WS-7）
 * @returns {MetaServerPluginRow[]}
 */
export function getMetaServerRecommendedPlugins() {
    return [
        { pluginId: 'matsuyama-flights', enabled: true, note: 'meta に明示行なし・ディレクトリあり' },
        { pluginId: 'xr', enabled: true, metaLegacyId: 'webxr-vr' },
        { pluginId: 'meta-bench-r1', enabled: true },
        { pluginId: 'time-machine', enabled: true },
        { pluginId: 'vdb-volume', enabled: true, metaLegacyId: 'smoke-view' },
    ];
}

/**
 * @param {import('better-sqlite3').Database} db
 */
function ensureSchema(db) {
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
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} tenantId
 * @param {MetaServerPluginRow[]} rows
 */
export function upsertTenantPluginEnabled(db, tenantId, rows) {
    const stmt = db.prepare(
        `INSERT INTO tenant_plugin_enabled (tenant_id, plugin_id, enabled, updated_at)
         VALUES (?, ?, ?, strftime('%s','now'))
         ON CONFLICT(tenant_id, plugin_id) DO UPDATE SET
           enabled = excluded.enabled,
           updated_at = excluded.updated_at`
    );
    /** @type {string[]} */
    const applied = [];
    for (const row of rows) {
        stmt.run(tenantId, row.pluginId, row.enabled ? 1 : 0);
        applied.push(row.pluginId);
    }
    return applied;
}

/**
 * @param {object} opts
 * @param {string} [opts.tenantId]
 * @param {string} [opts.dbPath]
 * @param {MetaServerPluginRow[]} [opts.plugins]
 * @returns {{ tenantId: string, dbPath: string, enabledPluginIds: string[] }}
 */
export function enableMetaServerTenantPlugins(opts = {}) {
    const tenantId = opts.tenantId ?? META_SERVER_TENANT_ID;
    const dbPath = opts.dbPath ?? DEFAULT_DB;
    const plugins = opts.plugins ?? getMetaServerRecommendedPlugins();

    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    try {
        ensureSchema(db);
        const enabledPluginIds = upsertTenantPluginEnabled(db, tenantId, plugins);
        return { tenantId, dbPath, enabledPluginIds };
    } finally {
        db.close();
    }
}

/**
 * @param {string[]} argv
 */
function parseCli(argv) {
    let tenantId = META_SERVER_TENANT_ID;
    let dbPath = DEFAULT_DB;
    const positional = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--db' && argv[i + 1]) {
            dbPath = path.resolve(argv[++i]);
            continue;
        }
        if (a === '--help' || a === '-h') {
            return { help: true, tenantId, dbPath };
        }
        if (!a.startsWith('-')) positional.push(a);
    }
    if (positional[0]) tenantId = positional[0];
    return { help: false, tenantId, dbPath };
}

function printHelp() {
    console.log(`Usage: node scripts/enable-tenant-plugins.mjs [tenantId] [--db path]

Defaults: tenantId=${META_SERVER_TENANT_ID}, db=${DEFAULT_DB}
Idempotent upsert into tenant_plugin_enabled (本番適用は WS-8).`);
}

const isMain =
    process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain) {
    const { help, tenantId, dbPath } = parseCli(process.argv.slice(2));
    if (help) {
        printHelp();
        process.exit(0);
    }
    const result = enableMetaServerTenantPlugins({ tenantId, dbPath });
    console.log(
        `[enable-tenant-plugins] tenant=${result.tenantId} db=${result.dbPath} plugins=${result.enabledPluginIds.join(', ')}`
    );
}