// e2e/tenant-login-avatar.spec.js — 入場ゲート / E2E harness で avatarId が保存される
import { test, expect } from '@playwright/test';
import { enterWorld } from './helpers/tenant-metaverse-agent.mjs';

test.describe('tenant login avatar gate', () => {
    test('E2E harness persists selected avatar id', async ({ page }) => {
        await enterWorld(page, { tenantId: 'P-01', username: 'AvatarE2E' });
        const avatarId = await page.evaluate(() =>
            localStorage.getItem('metaverseAvatarId:P-01'),
        );
        expect(avatarId).toBeTruthy();
        const active = await page.evaluate(async () => {
            const r = await fetch('/P-01/api/active-avatar', { credentials: 'include' });
            return r.json();
        });
        expect(active.path || active.glbPath).toMatch(/^avatars\//);
    });
});
