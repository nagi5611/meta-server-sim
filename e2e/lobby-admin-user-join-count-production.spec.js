// e2e/lobby-admin-user-join-count-production.spec.js — 参加回数が管理 API / UI に反映される（本番）
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const LOBBY_ORIGIN = (process.env.E2E_LOBBY_ORIGIN || 'https://m.mmh-virtual.jp').replace(/\/$/, '');
const ADMIN_EMAIL = process.env.LOBBY_ADMIN_EMAIL || process.env.E2E_LOBBY_ADMIN_EMAIL || '';
const ADMIN_PASS = process.env.LOBBY_ADMIN_PASSWORD || process.env.E2E_LOBBY_ADMIN_PASSWORD || '';
const LOBBY_USER_EMAIL = process.env.LOBBY_USER_EMAIL || process.env.E2E_LOBBY_USER_EMAIL || '';
const LOBBY_USER_PASS = process.env.LOBBY_USER_PASSWORD || process.env.E2E_LOBBY_USER_PASSWORD || '';
const ARTIFACT_DIR = '/opt/cursor/artifacts';

async function lobbyLogin(page) {
    await page.goto(`${LOBBY_ORIGIN}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('#auth-open, [data-auth-open]').first().click({ timeout: 15_000 }).catch(() => {});
    const emailInput = page.locator('#auth-email, input[name="email"], #login-email').first();
    const passInput = page.locator('#auth-password, input[name="password"], #login-password').first();
    await expect(emailInput).toBeVisible({ timeout: 20_000 });
    await emailInput.fill(LOBBY_USER_EMAIL);
    await passInput.fill(LOBBY_USER_PASS);
    await page.locator('#auth-submit, [data-auth-submit], button[type="submit"]').first().click();
    await page.waitForTimeout(2000);
}

async function adminLogin(page) {
    await page.goto(`${LOBBY_ORIGIN}/admin/`, { waitUntil: 'domcontentloaded' });
    await page.locator('#gUser, input[name="email"], input[name="username"]').first().fill(ADMIN_EMAIL);
    await page.locator('#gPass, input[name="password"]').first().fill(ADMIN_PASS);
    await page.locator('#gateSubmit, button[type="submit"]').first().click();
    await expect(page.locator('#app')).toBeVisible({ timeout: 60_000 });
}

test.describe('lobby admin user join count (production)', () => {
    test.skip(
        !ADMIN_EMAIL || !ADMIN_PASS || !LOBBY_USER_EMAIL || !LOBBY_USER_PASS,
        'Set LOBBY_ADMIN_EMAIL, LOBBY_ADMIN_PASSWORD, LOBBY_USER_EMAIL, LOBBY_USER_PASSWORD',
    );

    test('join-world increments user join count in admin panel', async ({ page }) => {
        fs.mkdirSync(ARTIFACT_DIR, { recursive: true });

        await adminLogin(page);
        await page.locator('[data-nav="users"]').click();
        await expect(page.locator('.us table')).toBeVisible({ timeout: 30_000 });

        const apiUsersBefore = await page.evaluate(async () => {
            const res = await fetch('/admin/api/users', { credentials: 'include' });
            return res.json();
        });
        const target = (apiUsersBefore.users || []).find((u) =>
            String(u.email || '').toLowerCase() === LOBBY_USER_EMAIL.toLowerCase(),
        );
        expect(target, 'target lobby user in admin users list').toBeTruthy();
        const beforeCount = Array.isArray(target.history) ? target.history.length : 0;

        await lobbyLogin(page);
        const joinRes = await page.evaluate(async () => {
            const listRes = await fetch('/api/metaverses', { credentials: 'include' });
            const list = await listRes.json().catch(() => ({}));
            const world = (list.metaverses || []).find((w) => w.id) || null;
            if (!world?.id) return { ok: false, status: 0, error: 'no_world' };
            const res = await fetch('/api/join-world', {
                method: 'POST',
                credentials: 'include',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ worldId: world.id, displayName: 'JoinCountE2E' }),
            });
            return { ok: res.ok, status: res.status, worldId: world.id };
        });
        expect(joinRes.ok, `join-world status ${joinRes.status}`).toBe(true);

        await adminLogin(page);
        await page.locator('[data-nav="users"]').click();
        await expect(page.locator('.us table')).toBeVisible({ timeout: 30_000 });

        await expect
            .poll(
                async () => {
                    const data = await page.evaluate(async () => {
                        const res = await fetch('/admin/api/users', { credentials: 'include' });
                        return res.json();
                    });
                    const u = (data.users || []).find((x) =>
                        String(x.email || '').toLowerCase() === LOBBY_USER_EMAIL.toLowerCase(),
                    );
                    return u?.history?.length ?? 0;
                },
                { timeout: 30_000 },
            )
            .toBeGreaterThan(beforeCount);

        const userRow = page.locator(`tr.row[data-user="${target.id}"]`);
        await expect(userRow).toBeVisible();
        await userRow.click();
        await expect(page.locator('.det-k')).toContainText(/参加.*回/);

        await page.screenshot({
            path: path.join(ARTIFACT_DIR, 'lobby-admin-user-join-count.png'),
            fullPage: true,
        });

        fs.writeFileSync(
            path.join(ARTIFACT_DIR, 'lobby-admin-join-count-evidence.json'),
            JSON.stringify({ userId: target.id, beforeCount, lobbyUserEmail: LOBBY_USER_EMAIL }, null, 2),
            'utf8',
        );
    });
});