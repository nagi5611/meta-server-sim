// test/tenant-charts.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
    readCharts,
    writeCharts,
    chartExists,
    recordChartScore,
    getChartRanking,
    isChartFeaturesEnabled,
    resetChartScoresForTests,
} from '../lib/tenant-charts.js';
import { getTenantStoragePaths, ensureTenantDirectories } from '../lib/tenant-storage-paths.js';
import express from 'express';
import { getTenant, loadTenantRegistry } from '../lib/tenant-registry.js';
import { registerTenantChartPublicRoutes } from '../lib/tenant-chart-routes.js';

const ENV_KEY = 'ENABLE_CHART_FEATURES';

function makeTempTenant(chartFeaturesEnabled = true) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tenant-charts-test-'));
    const paths = getTenantStoragePaths(root);
    ensureTenantDirectories(paths);
    fs.writeFileSync(
        paths.CHARTS_PATH,
        JSON.stringify(
            {
                song_a: { id: 'song_a', name: 'Song A', notes: [] },
            },
            null,
            2
        ),
        'utf8'
    );
    return {
        id: 'test-tenant',
        displayName: 'test-tenant',
        enabled: true,
        rootPath: root,
        paths,
        ...(chartFeaturesEnabled ? { chartFeaturesEnabled: true } : {}),
    };
}

describe('tenant-charts', () => {
    /** @type {string | undefined} */
    let prevEnv;

    beforeEach(() => {
        prevEnv = process.env[ENV_KEY];
        resetChartScoresForTests();
    });

    afterEach(() => {
        if (prevEnv === undefined) delete process.env[ENV_KEY];
        else process.env[ENV_KEY] = prevEnv;
    });

    it('readCharts loads JSON from tenant data path', () => {
        const tenant = makeTempTenant();
        const charts = readCharts(tenant);
        assert.equal(chartExists(charts, 'song_a'), true);
        assert.equal(charts.song_a.name, 'Song A');
        fs.rmSync(tenant.rootPath, { recursive: true, force: true });
    });

    it('writeCharts persists updates atomically', () => {
        const tenant = makeTempTenant();
        const charts = readCharts(tenant);
        charts.song_b = { id: 'song_b', name: 'Song B', notes: [] };
        writeCharts(tenant, charts);
        const again = readCharts(tenant);
        assert.equal(chartExists(again, 'song_b'), true);
        fs.rmSync(tenant.rootPath, { recursive: true, force: true });
    });

    it('score submission and ranking (top 10)', async () => {
        const tenant = makeTempTenant();
        await recordChartScore(tenant, 'song_a', 'Alice', 9000);
        await recordChartScore(tenant, 'song_a', 'Bob', 9500);
        await recordChartScore(tenant, 'song_a', 'Carol', 8500);
        const top = await getChartRanking(tenant, 'song_a');
        assert.equal(top.length, 3);
        assert.equal(top[0].username, 'Bob');
        assert.equal(top[0].score, 9500);
        assert.equal(top[1].username, 'Alice');
        fs.rmSync(tenant.rootPath, { recursive: true, force: true });
    });

    it('chartExists is false for unknown id', () => {
        const tenant = makeTempTenant();
        const charts = readCharts(tenant);
        assert.equal(chartExists(charts, 'missing'), false);
        fs.rmSync(tenant.rootPath, { recursive: true, force: true });
    });

    it('isChartFeaturesEnabled respects tenant flag and platform env', () => {
        delete process.env[ENV_KEY];
        const enabledTenant = makeTempTenant(true);
        const disabledTenant = makeTempTenant(false);
        assert.equal(isChartFeaturesEnabled(enabledTenant), true);
        assert.equal(isChartFeaturesEnabled(disabledTenant), false);

        process.env[ENV_KEY] = '0';
        assert.equal(isChartFeaturesEnabled(enabledTenant), false);

        process.env[ENV_KEY] = '1';
        assert.equal(isChartFeaturesEnabled(disabledTenant), true);

        fs.rmSync(enabledTenant.rootPath, { recursive: true, force: true });
        fs.rmSync(disabledTenant.rootPath, { recursive: true, force: true });
    });

    it('P-01 remains chart-disabled without env or tenant flag', () => {
        delete process.env[ENV_KEY];
        loadTenantRegistry();
        const p01 = getTenant('P-01');
        assert.ok(p01, 'P-01 tenant must be loaded in registry');
        assert.equal(isChartFeaturesEnabled(p01), false);
    });

    it('meta-server tenant in repo enables charts via tenant.json', () => {
        delete process.env[ENV_KEY];
        loadTenantRegistry();
        const meta = getTenant('meta-server');
        assert.ok(meta, 'meta-server tenant should load');
        assert.equal(isChartFeaturesEnabled(meta), true);
        const charts = readCharts(meta);
        assert.equal(chartExists(charts, 'todoroki2026'), true);
    });

    it('HTTP API returns 404 for unknown chart score', async () => {
        const tenant = makeTempTenant(true);
        const app = express();
        const router = express.Router();
        router.use((req, _res, next) => {
            req.tenant = tenant;
            next();
        });
        registerTenantChartPublicRoutes(router);
        app.use(router);
        const server = app.listen(0);
        try {
            const { port } = server.address();
            const res = await fetch(`http://127.0.0.1:${port}/api/charts/nope/score`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ username: 'x', score: 100 }),
            });
            assert.equal(res.status, 404);
        } finally {
            await new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
            fs.rmSync(tenant.rootPath, { recursive: true, force: true });
        }
    });
});