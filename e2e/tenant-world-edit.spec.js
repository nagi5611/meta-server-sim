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
    await page.waitForFunction(
        () => document.getElementById('app') && !document.getElementById('app').hidden,
        null,
        { timeout: 180_000 }
    );
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
    test.describe.configure({ mode: 'serial' });
    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test.beforeEach(async () => {
        await new Promise((r) => setTimeout(r, 4_000));
    });

    test('P-01 world editor loads without CSP or module errors', async ({ page }) => {
        const consoleLines = attachConsoleWatchers(page);

        const worldsApi = await adminApiGet(page.request, '/admin/tenants/P-01/worlds');
        expect(worldsApi.ok(), `worlds API status ${worldsApi.status()}`).toBeTruthy();
        const worldsJson = await worldsApi.json();
        expect(Object.keys(worldsJson).length).toBeGreaterThan(0);

        await gotoMtWorldEdit(page);

        await page.mouse.move(820, 420);
        await page.waitForTimeout(250);
        const railBox = await page.locator('.side.rail').boundingBox();
        expect(railBox?.width ?? 999, 'collapsed rail width').toBeLessThan(56);

        const outlinerText = await page.locator('.wed-root .vout-scroll').innerText();
        for (const phrase of MOCK_MARKERS) {
            expect(outlinerText, `mock phrase "${phrase}" must be absent`).not.toContain(phrase);
        }

        const counts = await page.evaluate(() => {
            const wid = window.MT?.state?.ed?.worldId || 'lobby';
            const w = window.MT?.state?.ed?._worldsRoot?.[wid];
            const objectRows = (window.MT?.state?.ed?.objects || []).length;
            const rows = document.querySelectorAll(
                '.wed-root .vout-scroll .vo-row[data-ed-obj], .wed-root .vout-scroll .vo-row[data-ed-sel-world]'
            ).length;
            return { objectRows, rows, live: !!window.MT?.state?.ed?._live };
        });
        expect(counts.live).toBe(true);
        expect(counts.rows).toBe(counts.objectRows + 1);

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

        const fill = await page.waitForFunction(
            () => {
                if (window.ME?.fitScene) window.ME.fitScene();
                const me = window.ME;
                const scene = me?.scene;
                const renderer = me?.renderer;
                const camera = me?.camera;
                if (renderer && scene && camera) renderer.render(scene, camera);
                const canvas = document.querySelector('.wed-root [data-canvas] canvas');
                if (!canvas) return false;
                const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
                if (!gl) return false;
                const w = canvas.width;
                const h = canvas.height;
                const step = Math.max(4, Math.floor(Math.min(w, h) / 64));
                const buf = new Uint8Array(4);
                const samples = [];
                for (let y = 0; y < h; y += step) {
                    for (let x = 0; x < w; x += step) {
                        gl.readPixels(x, h - 1 - y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, buf);
                        samples.push(`${buf[0]},${buf[1]},${buf[2]}`);
                    }
                }
                const bg = samples[0];
                const varied = samples.filter((s) => s !== bg).length;
                const ratio = samples.length ? varied / samples.length : 0;
                if (ratio > 0.08) return { ratio, total: samples.length, varied };
                return false;
            },
            null,
            { timeout: 180_000 }
        );
        const fill = await fill.jsonValue();
        expect(fill.ratio, `canvas non-bg pixel ratio ${JSON.stringify(fill)}`).toBeGreaterThan(0.08);

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

    test('P-01 lobby model is reachable and live spawn matches worlds.json', async ({ page, request }) => {
        const worldsBeforeRes = await adminApiGet(request, '/admin/tenants/P-01/worlds');
        expect(worldsBeforeRes.ok()).toBeTruthy();
        const worldsBefore = await worldsBeforeRes.json();
        const lobby = worldsBefore.lobby;
        expect(lobby).toBeTruthy();
        const spawnX = lobby.spawnPoint?.x ?? 0;

        const modelHead = await request.head('/P-01/models/lobby.glb');
        expect(modelHead.status(), 'lobby.glb should be served (R2 or local fallback)').toBe(200);

        await gotoMtWorldEdit(page);

        const spawnInState = await page.evaluate(() => {
            const sp = window.MT?.state?.ed?.objects?.find((o) => o.type === 'spawn');
            return sp?.pos?.[0];
        });
        expect(spawnInState).toBeCloseTo(spawnX, 4);
    });

    test('P-01 mt-editor draft save succeeds (worlds POST)', async ({ page, request }) => {
        attachConsoleWatchers(page);

        const worldsRes = await adminApiGet(request, '/admin/tenants/P-01/worlds');
        const worldsBefore = await worldsRes.json();
        const lobby = worldsBefore.lobby;
        const prevName = lobby.name || 'Lobby';

        await gotoMtWorldEdit(page);

        const tag = `pw-draft-${Date.now()}`;
        await page.evaluate((descTag) => {
            const ed = window.MT.state.ed;
            ed.worldName = `Lobby ${descTag}`;
            ed.dirty = true;
            window.MT.render();
        }, tag);

        await page.locator('.wed-root [data-ed-act="draft"]').click();
        await page.waitForFunction(
            async (descTag) => {
                try {
                    const res = await (window.__nativeAdminFetch || fetch)(
                        `/admin/tenants/P-01/worlds`,
                        { credentials: 'include' }
                    );
                    if (!res.ok) return false;
                    const w = (await res.json()).lobby;
                    return w?.name?.includes(descTag);
                } catch {
                    return false;
                }
            },
            tag,
            { timeout: 120_000 }
        );

        const worldsAfterRes = await adminApiGet(request, '/admin/tenants/P-01/worlds');
        const worldsAfter = await worldsAfterRes.json();
        expect(worldsAfter.lobby?.name).toContain(tag);

        const csrfRes = await request.get('/admin/csrf-token', { headers: adminBasicAuthHeaders() });
        const { token: csrfToken } = await csrfRes.json();
        await request.post('/admin/tenants/P-01/worlds', {
            headers: {
                ...adminBasicAuthHeaders(),
                'Content-Type': 'application/json',
                'X-Admin-CSRF': csrfToken,
            },
            data: { ...worldsAfter, lobby: { ...worldsAfter.lobby, name: prevName } },
        });
    });
});