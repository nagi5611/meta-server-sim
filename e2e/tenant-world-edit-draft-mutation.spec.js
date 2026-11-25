// e2e/tenant-world-edit-draft-mutation.spec.js — 実テナント worlds を書き換える（明示フラグ時のみ・1 回実行想定）
import { test, expect } from '@playwright/test';
import {
    adminApiGet,
    adminBasicAuthHeaders,
    attachStagingSimForwardHeaders,
} from './helpers/admin-basic-auth.mjs';

const ALLOW = process.env.E2E_ALLOW_STAGING_WORLD_DRAFT_SAVE === '1';
const ADMIN_USER = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASSWORD || 'dev-admin-password-16';

test.describe('tenant world edit draft mutation (opt-in)', () => {
    test.skip(!ALLOW, 'Set E2E_ALLOW_STAGING_WORLD_DRAFT_SAVE=1 to run draft save against real staging data');

    test.describe.configure({ mode: 'serial' });
    test.use({
        httpCredentials: { username: ADMIN_USER, password: ADMIN_PASS },
    });

    test('P-01 draft save then revert worlds.json fields', async ({ page, request }) => {
        await attachStagingSimForwardHeaders(page);
        const worldsRes = await adminApiGet(request, '/admin/tenants/P-01/worlds');
        const worldsBefore = await worldsRes.json();
        const lobby = worldsBefore.lobby;
        const prevName = lobby?.name || 'Lobby';
        const prevDesc = lobby?.description ?? lobby?.desc ?? '';

        await page.goto('/admin/tenant/P-01/world-edit', { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(
            () => window.MT?.state?.ed?._live && !window.MT.state.ed.loading,
            null,
            { timeout: 180_000 }
        );

        const tag = `pw-draft-e2e-${Date.now()}`;
        await page.evaluate((descTag) => {
            const ed = window.MT.state.ed;
            ed.worldName = `Lobby ${descTag}`;
            ed.settings.desc = descTag;
            ed.dirty = true;
            window.MT.render();
        }, tag);

        const worldsPost = page.waitForResponse(
            (r) =>
                r.url().includes('/admin/tenants/P-01/worlds') &&
                r.request().method() === 'POST' &&
                r.status() < 500,
            { timeout: 120_000 }
        );
        await page.locator('.wed-root [data-ed-act="draft"]').click();
        const postRes = await worldsPost;
        expect(postRes.ok(), `worlds POST status ${postRes.status()}`).toBeTruthy();

        const worldsAfterRes = await adminApiGet(request, `/admin/tenants/P-01/worlds?_=${Date.now()}`);
        const worldsAfter = await worldsAfterRes.json();
        expect(worldsAfter.lobby?.name).toContain(tag);

        const csrfRes = await request.get('/admin/csrf-token', { headers: adminBasicAuthHeaders() });
        const { token: csrfToken } = await csrfRes.json();
        const revert = {
            ...worldsAfter,
            lobby: {
                ...worldsAfter.lobby,
                name: prevName,
                description: prevDesc,
            },
        };
        delete revert.lobby.desc;
        const revertRes = await request.post('/admin/tenants/P-01/worlds', {
            headers: {
                ...adminBasicAuthHeaders(),
                'Content-Type': 'application/json',
                'X-Admin-CSRF': csrfToken,
            },
            data: revert,
        });
        expect(revertRes.ok(), `revert POST status ${revertRes.status()}`).toBeTruthy();

        const worldsFinalRes = await adminApiGet(request, `/admin/tenants/P-01/worlds?_=${Date.now()}`);
        const worldsFinal = await worldsFinalRes.json();
        expect(worldsFinal.lobby?.name).toBe(prevName);
        expect(worldsFinal.lobby?.description ?? '').toBe(prevDesc);
    });
});