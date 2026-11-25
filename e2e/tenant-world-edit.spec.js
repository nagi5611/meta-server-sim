// e2e/tenant-world-edit.spec.js
import { test, expect } from '@playwright/test';
import {
    adminApiGet,
    adminBasicAuthHeaders,
    attachStagingSimForwardHeaders,
} from './helpers/admin-basic-auth.mjs';

const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'dev-admin-password-16';

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

        await page.goto('/admin/tenant/P-01/world-edit');

        await expect(page.locator('#app')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('body.in-editor')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.side.rail')).toBeVisible();
        await expect(page.locator('.wed-root #canvas, #canvas')).toBeVisible({ timeout: 180_000 });
        await expect(page.locator('#world-list .item').first()).toBeVisible({ timeout: 180_000 });

        const diag = await page.evaluate(() => ({
            tenant: window.MT?.state?.tenant,
            worldId: window.MT?.state?.worldId,
            worldCount: window.MTD?.TENANTS?.find((t) => t.id === 'P-01')?.worlds?.length ?? 0,
            editorMounted: Boolean(window.ME?.isMounted),
        }));

        expect(diag.tenant, 'tenant context').toBe('P-01');
        expect(diag.worldCount, 'worlds from API').toBeGreaterThan(0);

        const cspViolations = consoleLines.filter(
            (t) =>
                t.includes('Content Security Policy') ||
                t.includes('violates the following Content Security Policy')
        );
        const moduleFailures = consoleLines.filter(
            (t) =>
                t.includes('world-editor.js') ||
                t.includes('flight-board-filter.js') ||
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

        const marker = Date.now() % 1000;
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
        expect(worldsAfter.lobby?.spawnPoint?.x).toBe(marker);

        const modelHead = await request.head('/P-01/models/lobby.glb');
        expect(modelHead.status(), 'lobby.glb should be served (R2 or local fallback)').toBe(200);

        await page.goto('/admin-legacy/tenant/P-01/world-edit');
        await expect(page.locator('#canvas')).toBeVisible({ timeout: 120_000 });
        await expect(page.locator('#world-list .item').first()).toBeVisible({ timeout: 120_000 });

        const lobbyItem = page.locator('#world-list .item').filter({ hasText: /lobby/i });
        await lobbyItem.click();
        await page.locator('.we-right-category-btn[data-we-right-category="settings"]').click();
        await page
            .locator('#panel-spawn details')
            .filter({ hasText: 'スポーン位置' })
            .locator('summary')
            .click();
        const spawnX = page.locator('#spawn-x');
        await expect(spawnX).toBeVisible();
        await spawnX.fill(String(marker));
        await expect(page.locator('#spawn-x')).toHaveValue(String(marker));
    });

    test('P-01 legacy world-edit save button succeeds (worlds/patch)', async ({ page }) => {
        const consoleLines = attachConsoleWatchers(page);

        await page.goto('/admin-legacy/tenant/P-01/world-edit');
        await expect(page.locator('#canvas')).toBeVisible({ timeout: 120_000 });
        await expect(page.locator('#world-list .item').first()).toBeVisible({ timeout: 120_000 });

        const lobbyItem = page.locator('#world-list .item').filter({ hasText: /lobby/i });
        await lobbyItem.click();

        await page.locator('.we-right-category-btn[data-we-right-category="settings"]').click();
        await page
            .locator('#panel-spawn details')
            .filter({ hasText: 'スポーン位置' })
            .locator('summary')
            .click();

        const spawnX = page.locator('#spawn-x');
        await expect(spawnX).toBeVisible();
        const current = Number(await spawnX.inputValue());
        const next = Number.isFinite(current) ? current + 0.001 : 42;
        await spawnX.fill(String(next));

        const saveBtn = page.locator('#btn-save');
        await expect(saveBtn).toBeEnabled();
        await saveBtn.click();

        const saveStatus = page.locator('#save-status');
        await expect(saveStatus).toContainText(/保存しました/, { timeout: 120_000 });
        await expect(saveStatus).not.toHaveClass(/error/);

        const failures = consoleLines.filter(
            (t) => t.includes('tenant_not_found') || t.includes('tenant not found')
        );
        expect(failures, failures.join(' | ')).toEqual([]);
    });
});
