// e2e/tenant-matsuyama-flights.spec.js — 発着板の実画面・ピクセル検証
import path from 'node:path';
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { TENANT_ID, ADMIN_USER, ADMIN_PASS } from './helpers/tenant-metaverse.mjs';
import { enterWorld } from './helpers/tenant-metaverse-agent.mjs';

const PLUGIN_ID = 'matsuyama-flights';
const ARTIFACTS = '/opt/cursor/artifacts';

async function fetchAdminCsrf(request) {
    const res = await request.get('/admin/csrf-token');
    expect(res.ok()).toBeTruthy();
    const data = await res.json();
    return data.token;
}

test.describe('matsuyama-flights addon', () => {
    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('flight board renders with live or fallback data', async ({ page, request }) => {
        test.setTimeout(240_000);
        fs.mkdirSync(ARTIFACTS, { recursive: true });

        const csrf = await fetchAdminCsrf(request);
        const headers = { 'X-Admin-CSRF': csrf };

        const enable = await request.post(`/admin/tenant/${TENANT_ID}/plugins/${PLUGIN_ID}/enable`, {
            headers,
        });
        if (enable.status() === 404) {
            test.skip(true, 'matsuyama-flights plugin not discovered in catalog');
        }
        expect(enable.ok(), await enable.text()).toBeTruthy();
        await request.post(`/admin/tenant/${TENANT_ID}/plugins/reload`, { headers });

        const boardAfter = await request.get(`/${TENANT_ID}/api/addons/matsuyama-flights/board`);
        expect(boardAfter.ok() || boardAfter.status() === 503).toBeTruthy();

        await enterWorld(page, { tenantId: TENANT_ID, username: `FlightE2E-${Date.now()}` });

        await page.waitForFunction(
            () => document.documentElement.dataset.tenantMetaverseReady === 'true',
            undefined,
            { timeout: 120_000 }
        );

        await page.waitForFunction(
            () => globalThis.__tenantMatsuyamaFlightsPluginLoaded === true,
            undefined,
            { timeout: 60_000 }
        );

        await page.waitForFunction(
            () => {
                const st = globalThis.__tenantMatsuyamaFlights;
                return st && st.meshCount >= 1 && st.hasCanvasLed === true;
            },
            undefined,
            { timeout: 120_000 }
        );

        const samples = await page.evaluate(async () => {
            const st = globalThis.__tenantMatsuyamaFlights;
            const app = globalThis.__tenantMatsuyamaFlightsAppRef;
            const board = st.findBoard();
            if (!board?.isMesh) {
                return { ok: false, reason: 'board mesh missing or wrong three type' };
            }

            st.frameBoard();
            const framed = await st.measureViewportLedYellow();

            const camera = app.sceneManager.getCamera();
            const renderer = app.sceneManager.getRenderer();
            const scene = app.sceneManager.getScene();
            const saved = {
                position: camera.position.clone(),
                quaternion: camera.quaternion.clone(),
            };
            camera.position.set(80, 18, 80);
            camera.lookAt(0, 2, 120);
            camera.updateProjectionMatrix();
            renderer.render(scene, camera);
            const away = await st.measureViewportLedYellow();
            camera.position.copy(saved.position);
            camera.quaternion.copy(saved.quaternion);
            renderer.render(scene, camera);

            return {
                ok: true,
                framed,
                away,
                png: framed.png,
                meshUuid: board.uuid,
            };
        });

        expect(samples.ok, samples.reason || 'sample failed').toBe(true);
        expect(samples.framed.hasLed, 'viewport center should contain LED yellow pixels').toBe(true);
        expect(samples.framed.hits, 'framed board LED hits').toBeGreaterThan(40);
        expect(
            samples.framed.hits,
            'framed view should show far more LED yellow than away-facing view'
        ).toBeGreaterThan(Math.max(samples.away.hits * 4, 20));

        expect(samples.png, 'framed PNG capture').toBeTruthy();
        const pngPath = path.join(ARTIFACTS, 'matsuyama-flights-board.png');
        fs.writeFileSync(pngPath, Buffer.from(samples.png.split(',')[1], 'base64'));
        expect(fs.statSync(pngPath).size).toBeGreaterThan(100_000);
    });
});