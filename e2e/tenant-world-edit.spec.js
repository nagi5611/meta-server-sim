// e2e/tenant-world-edit.spec.js
import { test, expect } from '@playwright/test';
import {
    adminApiGet,
    adminBasicAuthHeaders,
    attachStagingSimForwardHeaders,
} from './helpers/admin-basic-auth.mjs';

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'dev-admin-password-16';

const MOCK_MARKERS = ['街灯 01', '中央ステージ', '案内アバター', '夜のネオン商店街', 'AKARI City'];

/**
 * CSP / 致命的コンソールを収集する
 * @param {import('@playwright/test').Page} page
 */
function attachConsoleWatchers(page) {
    const lines = [];
    page.on('console', (msg) => {
        lines.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
        lines.push(`[pageerror] ${err}`);
    });
    return lines;
}

async function gotoMtWorldEdit(page) {
    await attachStagingSimForwardHeaders(page);
    await page.goto('/admin/tenant/P-01/world-edit', { waitUntil: 'load' });
    await expect(page.locator('#app')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('body.in-editor')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.side.rail')).toBeVisible();
    await page.waitForFunction(
        () => window.MT?.state?.ed?._live && !window.MT.state.ed.loading,
        null,
        { timeout: 180_000 }
    );
    await page.waitForFunction(
        () => {
            const root = document.querySelector('.wed-root');
            if (!root) return false;
            const canvas = root.querySelector('[data-canvas] canvas');
            if (!canvas) return false;
            return canvas.getBoundingClientRect().width > 64;
        },
        null,
        { timeout: 180_000 }
    );
}

test.describe('tenant world edit', () => {
    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('P-01 world editor loads without CSP or module errors', async ({ page }) => {
        const consoleLines = attachConsoleWatchers(page);

        const worldsApi = await adminApiGet(page.request, '/admin/tenants/P-01/worlds');
        expect(worldsApi.ok(), `worlds API status ${worldsApi.status()}`).toBeTruthy();
        const worldsJson = await worldsApi.json();
        expect(Object.keys(worldsJson).length).toBeGreaterThan(0);

        await gotoMtWorldEdit(page);

        const railBox = await page.locator('.side.rail').boundingBox();
        expect(railBox?.width ?? 999, 'collapsed rail width').toBeLessThan(56);

        const outlinerText = await page.locator('.wed-root .vout-scroll').innerText();
        for (const phrase of MOCK_MARKERS) {
            expect(outlinerText, `mock phrase "${phrase}" must be absent`).not.toContain(phrase);
        }

        const counts = await page.evaluate(() => {
            const wid = window.MT?.state?.ed?.worldId || 'lobby';
            const w = window.MT?.state?.ed?._worldsRoot?.[wid];
            const expected = window.MTWL?.expectedObjectCount?.(w) ?? -1;
            const rows = document.querySelectorAll('.wed-root .vout-scroll .vo-row').length;
            return { expected, rows, live: !!window.MT?.state?.ed?._live };
        });
        expect(counts.live).toBe(true);
        expect(counts.rows).toBe(counts.expected);

        await page.waitForFunction(
            () => {
                let meshes = 0;
                const scene = window.ME?.scene;
                if (!scene) return false;
                scene.traverse((c) => {
                    if (c.isMesh && c.name !== '__placeholder') meshes += 1;
                });
                return meshes >= 8;
            },
            null,
            { timeout: 180_000 }
        );

        const diag = await page.evaluate(() => ({
            tenant: window.MT?.state?.tenant,
            worldId: window.MT?.state?.worldId,
            editorMounted: Boolean(window.ME?.isMounted),
        }));

        expect(diag.tenant, 'tenant context').toBe('P-01');
        expect(diag.editorMounted).toBe(true);

        const cspViolations = consoleLines.filter(
            (t) =>
                t.includes('Content Security Policy') ||
                t.includes('violates the following Content Security Policy')
        );
        const moduleFailures = consoleLines.filter(
            (t) =>
                t.includes('Failed to load module') ||
                t.includes('Failed to fetch dynamically imported module')
        );
        const pageErrors = consoleLines.filter((t) => t.startsWith('[pageerror]'));

        expect(cspViolations, `CSP violations: ${cspViolations.join(' | ')}`).toEqual([]);
        expect(moduleFailures, `module load failures: ${moduleFailures.join(' | ')}`).toEqual([]);
        expect(pageErrors, `page errors: ${pageErrors.join(' | ')}`).toEqual([]);
    });

    test('P-01 lobby model is reachable and worlds save round-trips', async ({ page, request }) => {
        const csrfRes = await request.get('/admin/csrf-token', {
            headers: adminBasicAuthHeaders(),
        });
        expect(csrfRes.ok()).toBeTruthy();
        const { token } = await csrfRes.json();

        const worldsBeforeRes = await adminApiGet(request, '/admin/tenants/P-01/worlds');
        expect(worldsBeforeRes.ok()).toBeTruthy();
        const worldsBefore = await worldsBeforeRes.json();
        const lobby = worldsBefore.lobby;
        expect(lobby).toBeTruthy();

        const marker = (Date.now() % 1000) / 10 + 0.1;
        const nextSpawn = {
            ...(lobby.spawnPoint || { x: 0, y: 10, z: 0 }),
            x: marker,
        };
        const payload = {
            ...worldsBefore,
            lobby: {
                ...lobby,
                spawnPoint: nextSpawn,
            },
        };

        const saveRes = await request.post('/admin/tenants/P-01/worlds', {
            headers: {
                ...adminBasicAuthHeaders(),
                'Content-Type': 'application/json',
                'X-Admin-CSRF': token,
            },
            data: payload,
        });
        expect(saveRes.ok(), `worlds save status ${saveRes.status()}`).toBeTruthy();

        const worldsAfterRes = await adminApiGet(request, '/admin/tenants/P-01/worlds');
        expect(worldsAfterRes.ok()).toBeTruthy();
        const worldsAfter = await worldsAfterRes.json();
        expect(worldsAfter.lobby?.spawnPoint?.x).toBeCloseTo(marker, 5);

        const modelHead = await request.head('/P-01/models/lobby.glb');
        expect(modelHead.status(), 'lobby.glb should be served (R2 or local fallback)').toBe(200);

        await gotoMtWorldEdit(page);

        const spawnInState = await page.evaluate(() => {
            const sp = window.MT?.state?.ed?.objects?.find((o) => o.type === 'spawn');
            return sp?.pos?.[0];
        });
        expect(spawnInState).toBeCloseTo(marker, 5);
    });

    test('P-01 mt-editor draft save succeeds (worlds POST)', async ({ page, request }) => {
        attachConsoleWatchers(page);

        const worldsRes = await adminApiGet(request, '/admin/tenants/P-01/worlds');
        const worldsBefore = await worldsRes.json();
        const lobby = worldsBefore.lobby;
        const prevDesc = lobby.description || '';

        await gotoMtWorldEdit(page);

        const tag = `pw-draft-${Date.now()}`;
        await page.evaluate((descTag) => {
            const ed = window.MT.state.ed;
            ed.settings.desc = descTag;
            ed.dirty = true;
            window.MT.render();
        }, tag);

        await page.locator('.wed-root [data-ed-act="draft"]').click();
        await page.waitForFunction(
            () => {
                const s = document.querySelector('[data-save-state]');
                return s && !s.classList.contains('dirty') && s.textContent?.includes('保存');
            },
            null,
            { timeout: 120_000 }
        );

        const worldsAfterRes = await adminApiGet(request, '/admin/tenants/P-01/worlds');
        const worldsAfter = await worldsAfterRes.json();
        expect(worldsAfter.lobby?.description).toBe(tag);

        await request.post('/admin/tenants/P-01/worlds', {
            headers: {
                ...adminBasicAuthHeaders(),
                'Content-Type': 'application/json',
                'X-Admin-CSRF': (await request.get('/admin/csrf-token', { headers: adminBasicAuthHeaders() }).then((r) => r.json())).token,
            },
            data: { ...worldsAfter, lobby: { ...worldsAfter.lobby, description: prevDesc } },
        });
    });
});