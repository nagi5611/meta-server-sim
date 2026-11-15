// e2e/prod-world-edit-manifest-console.spec.js — prod smoke: no manifest 404 spam
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.PROD_SIM_URL || 'https://sim.mmh-virtual.jp';

function loadAdminPass() {
    if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
    const mcp = path.resolve(
        process.cwd(),
        '../metaverse-simple/mcp/metaverse-admin/.env.mcp',
    );
    const env = fs.readFileSync(mcp, 'utf8');
    const b64 = env.match(/^META_ADMIN_PASSWORD_B64=(.*)$/m)?.[1]?.trim();
    if (!b64) throw new Error('ADMIN_PASSWORD or .env.mcp required');
    return Buffer.from(b64, 'base64').toString('utf8');
}

test.describe('prod world edit manifest console', () => {
    test.use({
        baseURL: BASE,
        httpCredentials: { username: 'admin', password: loadAdminPass() },
    });

    test('school world load: no repeated fugaku manifest 404', async ({ page }) => {
        const lines = [];
        page.on('console', (msg) => lines.push(`[${msg.type()}] ${msg.text()}`));
        page.on('requestfailed', (req) => {
            if (req.url().includes('manifest.json')) {
                lines.push(`[requestfailed] ${req.url()} ${req.failure()?.errorText || ''}`);
            }
        });

        await page.goto('/admin/tenant/P-01/world-edit', { waitUntil: 'networkidle' });
        await expect(page.locator('#canvas')).toBeVisible({ timeout: 120_000 });
        await expect(page.locator('#world-list .item').first()).toBeVisible({ timeout: 180_000 });

        const picked = await page.evaluate(async () => {
            const r = await fetch('/admin/tenants/P-01/worlds', { credentials: 'include' });
            const worlds = await r.json();
            const id =
                Object.keys(worlds).find((wid) =>
                    (worlds[wid]?.fdsSmokes || []).some((s) =>
                        String(s.manifest || '').includes('fugaku-prod01'),
                    ),
                ) || Object.keys(worlds)[0];
            const row = document.querySelector(`#world-list .item[data-id="${id}"]`);
            row?.click();
            return id;
        });
        expect(picked).toBeTruthy();

        await page.waitForTimeout(10_000);

        const loadFailedSpam = lines.filter((t) =>
            t.includes('[TenantWorldEditFdsSmokePreview] load failed'),
        );

        expect(
            loadFailedSpam,
            `preview load failed spam: ${loadFailedSpam.join(' | ')}`,
        ).toEqual([]);
    });
});