// lib/playwright-tenant-entry.js — 本番テナント入場（ログインゲート等）

/**
 * @param {import('playwright').Page} page
 */
export async function prepareTenantPlaywrightEntry(page) {
    const gate = page.locator('#tenant-login-enter-btn');
    if (await gate.isVisible({ timeout: 8000 }).catch(() => false)) {
        await gate.click();
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