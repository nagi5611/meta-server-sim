// lib/playwright-tenant-entry.js — 本番テナント入場（ログインゲート等）

/**
 * @param {import('playwright').Page} page
 */
export async function prepareTenantPlaywrightEntry(page) {
    const gate = page.locator('#tenant-login-enter-btn');
    if (await gate.count()) {
        const clicked = await gate
            .click({ timeout: 5000, force: true })
            .then(() => true)
            .catch(() => false);
        if (!clicked) {
            await page
                .evaluate(() => document.getElementById('tenant-login-enter-btn')?.click())
                .catch(() => undefined);
        }
    }
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
        const ready = await page.evaluate(
            () => document.documentElement.dataset.tenantMetaverseReady === 'true',
        );
        if (ready) return;
        await page.waitForTimeout(1000);
    }
    throw new Error('tenantMetaverseReady timeout after login gate');
}