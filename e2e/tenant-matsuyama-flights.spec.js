// e2e/tenant-matsuyama-flights.spec.js — 発着板の実画面検証
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

        const boardRes = await request.get(
            `/${TENANT_ID}/api/tenant-plugins/${PLUGIN_ID}/board`
        );
        expect(
            boardRes.status(),
            'board should respond before plugin enable (404) or after enable (200/503)'
        ).toBeLessThan(500);

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

        const consoleLines = [];
        page.on('console', (msg) => consoleLines.push(`[${msg.type()}] ${msg.text()}`));

        await enterWorld(page, { tenantId: TENANT_ID, username: `FlightE2E-${Date.now()}` });

        await page.waitForFunction(
            () => document.documentElement.dataset.tenantMetaverseReady === 'true',
            undefined,
            { timeout: 120_000 }
        );

        const fetchDiag = await page.evaluate(async () => {
            const tenantId = location.pathname.split('/').filter(Boolean)[0];
            const url = `/${encodeURIComponent(tenantId)}/addons-client/matsuyama-flights/client/game.js`;
            try {
                const res = await fetch(url, { credentials: 'same-origin' });
                return { url, status: res.status, ct: res.headers.get('content-type') };
            } catch (e) {
                return { url, error: String(e) };
            }
        });
        expect(fetchDiag.status, JSON.stringify(fetchDiag)).toBe(200);

        const pluginDiag = await page.evaluate(async () => {
            const tenantId = location.pathname.split('/').filter(Boolean)[0];
            const enabledRes = await fetch(
                `/${encodeURIComponent(tenantId)}/api/tenants/${encodeURIComponent(tenantId)}/addons/enabled`,
                { credentials: 'include' }
            );
            const enabled = enabledRes.ok ? await enabledRes.json() : null;
            return {
                enabled,
                pluginLoaded: globalThis.__tenantMatsuyamaFlightsPluginLoaded === true,
                appRef: Boolean(globalThis.__tenantMatsuyamaFlightsAppRef),
                initPhase: globalThis.__tenantInitPhase,
            };
        });
        const pluginWarnings = consoleLines.filter((l) => l.includes('[tenant-plugins]'));
        expect(
            pluginDiag.pluginLoaded,
            `matsuyama client module not loaded: ${JSON.stringify(pluginDiag)}; warns=${pluginWarnings.join(' | ')}`
        ).toBe(true);

        await page.waitForFunction(
            () => Boolean(globalThis.__tenantMatsuyamaFlightsAppRef),
            undefined,
            { timeout: 120_000 }
        );

        await page.waitForFunction(
            () => {
                const canvas = document.getElementById('canvas');
                return Boolean(canvas?.__flightBoardMeshesReady);
            },
            undefined,
            { timeout: 120_000 }
        );

        const framed = await page.evaluate(async () => {
            const app = globalThis.__tenantMatsuyamaFlightsAppRef;
            const sceneMgr = app?.sceneManager;
            const renderer = sceneMgr?.getRenderer?.();
            const camera = sceneMgr?.getCamera?.();
            const scene = sceneMgr?.getScene?.();
            if (!sceneMgr || !renderer || !camera || !scene) {
                return { ok: false, reason: 'app not ready' };
            }
            /** @type {object|null} */
            let board = null;
            scene.traverse((obj) => {
                if (obj.userData?.flightBoardConfig && obj.isMesh) board = obj;
            });
            if (!board) {
                return { ok: false, reason: 'no flight board mesh' };
            }
            const p = board.userData.flightBoardConfig?.position || { x: -2, y: 3.2, z: -6 };
            camera.position.set(p.x + 3.5, p.y + 1.2, p.z + 2.8);
            camera.lookAt(p.x, p.y + 1.4, p.z);
            await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
            renderer.render(scene, camera);
            const tex = board.material?.map;
            const hasTexture = Boolean(tex?.image);
            return {
                ok: true,
                hasTexture,
                boardName: board.name,
                meshUuid: board.uuid,
            };
        });

        expect(framed.ok, `${framed.reason || 'frame failed'}; console: ${consoleLines.slice(-8).join(' | ')}`).toBe(
            true
        );
        expect(framed.hasTexture, 'flight board canvas texture should be painted').toBe(true);

        await page.screenshot({
            path: path.join(ARTIFACTS, 'matsuyama-flights-board.png'),
            fullPage: false,
        });
    });
});