// e2e/tenant-metaverse.spec.js
import { test, expect } from '@playwright/test';

/**
 * メタバース初期化完了まで待つ
 * @param {import('@playwright/test').Page} page
 */
async function expectMetaverseReady(page) {
    const consoleLines = [];
    page.on('console', (msg) => {
        consoleLines.push(`[${msg.type()}] ${msg.text()}`);
    });
    page.on('pageerror', (err) => {
        consoleLines.push(`[pageerror] ${err}`);
    });

    const controlOverlay = page.locator('#control-scheme-keyboard-btn');
    if (await controlOverlay.isVisible({ timeout: 3000 }).catch(() => false)) {
        await controlOverlay.click();
    }

    await expect(page.locator('#canvas')).toBeVisible({ timeout: 30_000 });

    try {
        await expect
            .poll(async () => page.locator('html').getAttribute('data-tenant-metaverse-ready'), {
                timeout: 90_000,
            })
            .toBe('true');
    } catch (e) {
        const socketStatus = await page.locator('#socket-status').textContent().catch(() => '');
        console.log('socket-status:', socketStatus);
        console.log('recent console:\n', consoleLines.slice(-40).join('\n'));
        throw e;
    }

    const fatal = consoleLines.filter(
        (t) =>
            t.includes('Maximum call stack size exceeded') ||
            t.includes('init failed') ||
            t.includes("Cannot read properties of undefined (reading 'image')")
    );
    expect(fatal, `console fatal errors: ${fatal.join(' | ')}`).toEqual([]);

    await expect(page.locator('#world-name')).not.toHaveText('-');
}

test.describe('tenant metaverse entry', () => {
    for (const tenantId of ['P-01', 'P-02']) {
        test(`${tenantId} loads on port 3003`, async ({ page }) => {
            await page.goto(`http://localhost:3003/${tenantId}/`);
            await expectMetaverseReady(page);
        });
    }

    test('P-03 loads on port 3004', async ({ page }) => {
        await page.goto('http://localhost:3004/P-03/');
        await expectMetaverseReady(page);
    });
});

test.describe('portal navigation', () => {
    test('portal links use http localhost and P-03 entry works', async ({ page }) => {
        await page.goto('http://localhost:3003/P-01/');
        await expectMetaverseReady(page);

        const nav = page.locator('#metaverse-portal-nav');
        await expect(nav).toBeVisible({ timeout: 10_000 });

        const simLink = page.locator('#metaverse-portal-links a').filter({ hasText: 'シミュレーション' });
        await expect(simLink).toHaveAttribute('href', /^http:\/\/localhost:3003/);

        const p03Link = page.locator('#metaverse-portal-links a').filter({ hasText: '333' });
        await expect(p03Link).toHaveAttribute('href', /^http:\/\/localhost:3004\/P-03/);

        await p03Link.click();
        await expect(page).toHaveURL(/localhost:3004\/P-03/);
        await expectMetaverseReady(page);
    });
});

test.describe('tenant API health', () => {
    test('each tenant client-config returns portal links via Vite proxy', async ({ request }) => {
        for (const tenantId of ['P-01', 'P-02', 'P-03']) {
            const port = tenantId === 'P-03' ? 3004 : 3003;
            const res = await request.get(
                `http://localhost:${port}/${tenantId}/api/client-config`
            );
            expect(res.ok(), `${tenantId} client-config status`).toBeTruthy();
            const data = await res.json();
            expect(data.tenantId).toBe(tenantId);
            expect(Array.isArray(data.portalLinks)).toBe(true);
            expect(data.portalLinks.length).toBeGreaterThan(0);
            for (const link of data.portalLinks) {
                expect(link.url).toMatch(/^http:\/\/localhost:/);
            }
        }
    });
});
