// e2e/tenant-aircraft.spec.js — 飛行機アドオン通し検証
import path from 'node:path';
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { TENANT_ID, ADMIN_USER, ADMIN_PASS } from './helpers/tenant-metaverse.mjs';
import { enterWorld, installTenantE2EHarness } from './helpers/tenant-metaverse-agent.mjs';
import { expectMetaverseReady, emitSocketAck, waitForSocketConnected } from './helpers/tenant-metaverse.mjs';

const PLUGIN_ID = 'aircraft';
const PLANE_ID = 'e2e-plane-1';
const ARTIFACTS = '/opt/cursor/artifacts';

async function fetchAdminCsrf(request) {
    const res = await request.get('/admin/csrf-token');
    expect(res.ok()).toBeTruthy();
    return (await res.json()).token;
}

test.describe('aircraft addon', () => {
    test.use({ httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS } });

    test('admin airframes, world plane, pilot sync, busy board', async ({ browser, request }) => {
        test.setTimeout(360_000);
        fs.mkdirSync(ARTIFACTS, { recursive: true });

        const csrf = await fetchAdminCsrf(request);
        const headers = { 'X-Admin-CSRF': csrf, 'Content-Type': 'application/json' };

        const enableRes = await request.post(`/admin/tenant/${TENANT_ID}/plugins/${PLUGIN_ID}/enable`, {
            headers,
        });
        expect(enableRes.ok()).toBeTruthy();
        const reloadRes = await request.post(`/admin/tenant/${TENANT_ID}/plugins/reload`, { headers });
        expect(reloadRes.ok()).toBeTruthy();

        const putAf = await request.put(`/admin/tenants/${TENANT_ID}/addons/aircraft/airframes/B787`, {
            headers,
            data: {
                displayName: 'Boeing 787 E2E',
                controlMode: 'easy',
                flightPhysicsEasy: { maxThrustSpeed: 95 },
            },
        });
        expect(putAf.ok()).toBeTruthy();

        const list = await request.get(`/admin/tenants/${TENANT_ID}/addons/aircraft/airframes`);
        const listJson = await list.json();
        expect(listJson.airframes?.some((a) => a.id === 'B787')).toBeTruthy();

        const worldsRes = await request.get(`/admin/tenants/${TENANT_ID}/worlds`);
        const worlds = await worldsRes.json();
        const lobby = worlds.lobby || worlds[TENANT_ID];
        lobby.models = lobby.models || [];
        lobby.models = lobby.models.filter((m) => m?.aircraft?.id !== PLANE_ID);
        lobby.models.push({
            path: 'models/monument.glb',
            position: { x: 12, y: 1.2, z: 8 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 2.5, y: 0.4, z: 4 },
            aircraft: {
                id: PLANE_ID,
                aircraftLibraryId: 'B787',
                radius: 6,
                label: '操縦する',
            },
        });
        const saveWorlds = await request.post(`/admin/tenants/${TENANT_ID}/worlds`, {
            headers,
            data: worlds,
        });
        expect(saveWorlds.ok()).toBeTruthy();

        const adminPage = await browser.newPage();
        await adminPage.goto(`http://localhost:3003/admin/tenant/${TENANT_ID}/world-edit`);
        await adminPage.waitForTimeout(3000);
        await fs.promises.writeFile(
            path.join(ARTIFACTS, 'aircraft-admin-world-edit.png'),
            await adminPage.screenshot({ fullPage: false })
        );
        await adminPage.close();

        const ctx = await browser.newContext();
        const pilot = await ctx.newPage();
        await installTenantE2EHarness(pilot);
        await enterWorld(pilot, { tenantId: TENANT_ID, username: `Pilot-${Date.now()}` });
        await expectMetaverseReady(pilot);
        await pilot.waitForFunction(
            () => globalThis.__tenantAircraftPluginLoaded && window.__tenantE2E?.getMetaverseApp()?.aircraftManager,
            undefined,
            { timeout: 120_000 },
        );

        await pilot.evaluate(() => {
            window.__tenantE2E.setLocalPosition(12, 1.2, 11);
        });
        await pilot.waitForTimeout(2000);
        await fs.promises.writeFile(
            path.join(ARTIFACTS, 'aircraft-on-ground.png'),
            await pilot.screenshot()
        );

        const boarded = await pilot.evaluate(async () => window.__tenantE2E.tryBoardNearestAircraft());
        expect(boarded).toBeTruthy();

        for (let i = 0; i < 30; i++) {
            await pilot.keyboard.press('w');
            await pilot.waitForTimeout(80);
        }
        for (let i = 0; i < 15; i++) {
            await pilot.keyboard.press('ArrowUp');
            await pilot.waitForTimeout(100);
        }
        await pilot.evaluate(() => window.__tenantE2E.setAircraftThrottle(1));
        await pilot.waitForTimeout(8000);

        const hud = await pilot.evaluate(() => window.__tenantE2E.getAircraftHud());
        expect(hud.piloting).toBe(true);
        expect(hud.altitude).toBeGreaterThan(1);

        await fs.promises.writeFile(
            path.join(ARTIFACTS, 'aircraft-flying-hud.png'),
            await pilot.screenshot()
        );

        const observerCtx = await browser.newContext();
        const observer = await observerCtx.newPage();
        await installTenantE2EHarness(observer);
        await enterWorld(observer, { tenantId: TENANT_ID, username: `Obs-${Date.now()}` });
        await expectMetaverseReady(observer);
        await observer.waitForTimeout(5000);
        await fs.promises.writeFile(
            path.join(ARTIFACTS, 'aircraft-observer-sync.png'),
            await observer.screenshot()
        );

        await pilot.waitForFunction(
            () => window.__tenantE2E?.getAircraftHud?.()?.piloting === true,
            undefined,
            { timeout: 30_000 },
        );

        await waitForSocketConnected(observer);
        const activeSlotId = await pilot.evaluate(
            () => window.__tenantE2E.getMetaverseApp()?.aircraftManager?.activeSlot?.id || '',
        );
        expect(activeSlotId).toBeTruthy();
        const pilotBoard = await emitSocketAck(pilot, 'aircraft-board', { slotId: activeSlotId });
        expect(pilotBoard?.ok).toBeTruthy();
        const busyAck = await emitSocketAck(observer, 'aircraft-board', { slotId: activeSlotId }, 30_000);
        expect(busyAck?.ok).toBeFalsy();
        expect(busyAck?.error).toBe('busy');

        await ctx.close();
        await observerCtx.close();
    });
});