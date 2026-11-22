// test/tenant-plugins-meta-server.test.js — meta-server テナント推奨プラグイン有効化スクリプト
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import Database from 'better-sqlite3';
import {
    META_SERVER_TENANT_ID,
    enableMetaServerTenantPlugins,
    getMetaServerRecommendedPlugins,
} from '../scripts/enable-tenant-plugins.mjs';

describe('meta-server tenant plugin presets', () => {
    it('lists sim plugin ids mapped from meta-server addons', () => {
        const rows = getMetaServerRecommendedPlugins();
        const ids = rows.map((r) => r.pluginId).sort();
        assert.deepEqual(ids, [
            'matsuyama-flights',
            'meta-bench-r1',
            'time-machine',
            'vdb-volume',
            'xr',
        ]);
        for (const row of rows) {
            assert.equal(row.enabled, true);
        }
        const legacy = Object.fromEntries(
            rows.filter((r) => r.metaLegacyId).map((r) => [r.metaLegacyId, r.pluginId])
        );
        assert.equal(legacy['webxr-vr'], 'xr');
        assert.equal(legacy['smoke-view'], 'vdb-volume');
    });

    it('enable script upserts tenant_plugin_enabled idempotently', () => {
        const dbPath = path.join(
            os.tmpdir(),
            `tenant_plugins_ws4_${process.pid}_${Date.now()}.db`
        );
        try {
            const first = enableMetaServerTenantPlugins({
                tenantId: META_SERVER_TENANT_ID,
                dbPath,
            });
            assert.equal(first.tenantId, 'meta-server');
            assert.equal(first.enabledPluginIds.length, 5);

            const second = enableMetaServerTenantPlugins({
                tenantId: META_SERVER_TENANT_ID,
                dbPath,
            });
            assert.deepEqual(second.enabledPluginIds.sort(), first.enabledPluginIds.sort());

            const db = new Database(dbPath, { readonly: true });
            const rows = db
                .prepare(
                    'SELECT plugin_id, enabled FROM tenant_plugin_enabled WHERE tenant_id = ? ORDER BY plugin_id'
                )
                .all(META_SERVER_TENANT_ID);
            db.close();

            assert.equal(rows.length, 5);
            for (const row of rows) {
                assert.equal(row.enabled, 1);
            }
        } finally {
            fs.rmSync(dbPath, { force: true });
        }
    });
});