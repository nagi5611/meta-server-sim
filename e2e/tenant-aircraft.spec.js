// e2e/tenant-aircraft.spec.js — 飛行機アドオン通し検証
import path from 'node:path';
import fs from 'node:fs';
import { test, expect } from '@playwright/test';
import { TENANT_ID, ADMIN_USER, ADMIN_PASS } from './helpers/tenant-metaverse.mjs';
import { enterWorld, installTenantE2EHarness } from './helpers/tenant-metaverse-agent.mjs';
import { expectMetaverseReady, emitSocketAck, waitForSocketConnected } from './helpers/tenant-metaverse.mjs';
import {
    expectAircraftVisualOnScene,
    expectCanvasAircraftPixels,
    expectAltitudeAbove,
    readAircraftHudNumbers,
} from './helpers/aircraft-visual.mjs';

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

        await request.put(`/admin/tenants/${TENANT_ID}/addons/aircraft/airframes/B787`, {
            headers: { ...headers, 'Content-Type': 'application/json' },
            data: {
                displayName: 'Boeing 787 E2E',
                controlMode: 'easy',
                prefabManifest: 'sim/builtin-aircraft',
                flightPhysicsEasy: { maxThrustSpeed: 95 },
            },
        });

        const worldsRes = await request.get(`/admin/tenants/${TENANT_ID}/worlds`);
        const worlds = await worldsRes.json();
        const lobby = worlds.lobby || worlds[TENANT_ID];
        const spawn = lobby.spawnPoint || { x: 0, y: 1.2, z: 0 };
        lobby.models = lobby.models || [];
        lobby.models = lobby.models.filter((m) => m?.aircraft?.id !== PLANE_ID);
        lobby.models.push({
            path: 'models/monument.glb',
            position: { x: spawn.x + 8, y: (spawn.y ?? 1.2) + 0.05, z: spawn.z + 6 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 0.01, y: 0.01, z: 0.01 },
            aircraft: {
                id: PLANE_ID,
                aircraftLibraryId: 'B787',
                radius: 8,
                label: '操縦する',
            },
        });
        const saveWorlds = await request.post(`/admin/tenants/${TENANT_ID}/worlds`, {
            headers: { ...headers, 'Content-Type': 'application/json' },
            data: worlds,
        });
        expect(saveWorlds.ok()).toBeTruthy();

        const adminPage = await browser.newPage();
        await adminPage.goto(`http://localhost:3003/admin/tenant/${TENANT_ID}/world-edit`);
        await adminPage.waitForSelector('.we-category-nav', { timeout: 60_000 });
        await adminPage.click('.we-category-btn[data-we-category="aircraft"]');
        await adminPage.waitForSelector('#sim-airframe-list', { timeout: 30_000 });
        await adminPage.waitForTimeout(1000);
        await fs.promises.writeFile(
            path.join(ARTIFACTS, 'aircraft-airframe-tags-admin.png'),
            await adminPage.screenshot({ fullPage: false }),
        );

        const worldObj = adminPage.locator('#sim-placed-aircraft-list .model-list-item').first();
        await expect(worldObj).toContainText(PLANE_ID, { timeout: 30_000 });

        const objListItem = adminPage.locator('#object-list .object-list-item', { hasText: PLANE_ID });
        if (await objListItem.count()) {
            await objListItem.first().click();
        }
        await adminPage.selectOption('#obj-vehicle-type', 'airplane');
        await adminPage.waitForTimeout(800);
        await fs.promises.writeFile(
            path.join(ARTIFACTS, 'aircraft-admin-world-edit.png'),
            await adminPage.screenshot({ fullPage: false }),
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

        await expectAircraftVisualOnScene(pilot);
        await expectCanvasAircraftPixels(pilot, 60);

        await pilot.evaluate(({ sx, sy, sz }) => {
            window.__tenantE2E.setLocalPosition(sx, sy, sz);
        }, { sx: spawn.x + 7, sy: (spawn.y ?? 1.2) + 0.2, sz: spawn.z + 5 });
        await pilot.waitForTimeout(2000);
        await fs.promises.writeFile(
            path.join(ARTIFACTS, 'aircraft-on-ground.png'),
            await pilot.screenshot(),
        );

        const boarded = await pilot.evaluate(async () => window.__tenantE2E.tryBoardNearestAircraft());
        expect(boarded).toBeTruthy();

        await pilot.keyboard.press('KeyV');
        await pilot.waitForTimeout(300);

        for (let i = 0; i < 40; i++) {
            await pilot.keyboard.press('KeyW');
            await pilot.waitForTimeout(60);
        }
        for (let i = 0; i < 20; i++) {
            await pilot.keyboard.press('ArrowUp');
            await pilot.waitForTimeout(80);
        }
        await pilot.evaluate(() => window.__tenantE2E.setAircraftThrottle(1));

        await expectAltitudeAbove(pilot, 4);
        const hudBefore = await readAircraftHudNumbers(pilot);
        expect(hudBefore.easy).toMatch(/\d/);

        await pilot.waitForTimeout(4000);
        const hudAfter = await readAircraftHudNumbers(pilot);
        expect(hudAfter.easy).toMatch(/\d/);
        expect(hudAfter.altitude).toBeGreaterThan(hudBefore.altitude ?? 0);

        await expectCanvasAircraftPixels(pilot, 40);
        await fs.promises.writeFile(
            path.join(ARTIFACTS, 'aircraft-flying-hud.png'),
            await pilot.screenshot(),
        );

        const observerCtx = await browser.newContext();
        const observer = await observerCtx.newPage();
        await installTenantE2EHarness(observer);
        await enterWorld(observer, { tenantId: TENANT_ID, username: `Obs-${Date.now()}` });
        await expectMetaverseReady(observer);
        await observer.waitForTimeout(3000);
        await expectAircraftVisualOnScene(observer);
        await expectCanvasAircraftPixels(observer, 30);
        await fs.promises.writeFile(
            path.join(ARTIFACTS, 'aircraft-observer-sync.png'),
            await observer.screenshot(),
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