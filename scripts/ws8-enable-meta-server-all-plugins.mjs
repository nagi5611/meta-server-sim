#!/usr/bin/env node
// scripts/ws8-enable-meta-server-all-plugins.mjs — WS-4 + WS-7 プラグインを tenant_plugins.db に有効化

import { enableMetaServerTenantPlugins } from './enable-tenant-plugins.mjs';
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath =
    process.argv[2] ||
    path.join(path.resolve(__dirname, '..'), 'data', 'platform', 'tenant_plugins.db');

const ws4 = enableMetaServerTenantPlugins({ dbPath });
const ws7Extras = ['nfc-spawn', 'admin-reboot'];
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);
const stmt = db.prepare(
    `INSERT INTO tenant_plugin_enabled (tenant_id, plugin_id, enabled, updated_at)
     VALUES (?, ?, 1, strftime('%s','now'))
     ON CONFLICT(tenant_id, plugin_id) DO UPDATE SET enabled = 1, updated_at = excluded.updated_at`
);
for (const pluginId of ws7Extras) {
    stmt.run('meta-server', pluginId);
}
db.close();
console.log(
    `[ws8-plugins] ws4=${ws4.enabledPluginIds.join(',')} ws7=${ws7Extras.join(',')}`
);