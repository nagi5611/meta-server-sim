import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ART = process.env.ARTIFACT_DIR || path.join(__dirname, '..', '..', 'artifacts');
const STAGING = 'https://staging.mmh-virtual.jp/P-01/';

async function main() {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

    await page.addInitScript(() => {
        window.__TENANT_E2E_HARNESS__ = '1';
        document.documentElement.dataset.e2eHarness = '1';
        try {
            localStorage.setItem('metaverse-control-scheme', 'keyboard');
            localStorage.setItem('username', 'portal-e2e');
        } catch {
            /* ignore */
        }
    });

    await page.goto(STAGING, { waitUntil: 'networkidle', timeout: 120000 });
    await page.waitForFunction(
        () => document.documentElement.dataset.tenantMetaverseReady === 'true',
        { timeout: 120000 }
    );
    await page.waitForTimeout(4000);

    const stagingUrl = page.url();
    await page.screenshot({
        path: path.join(ART, 'staging-p01-before-portal.png'),
        fullPage: false,
    });
    await import('node:fs/promises').then((fs) =>
        fs.writeFile(
            path.join(ART, 'staging-p01-before-portal.url.txt'),
            `${stagingUrl}\n`,
            'utf8'
        )
    );

    const zoneInfo = await page.evaluate(async () => {
        const app = window.__tenantE2E?.getMetaverseApp?.();
        if (!app) return { error: 'no app' };
        app.updateTeleportZones();
        const zone = app.teleportManager.teleportZones.find((z) =>
            String(z.destinationUrl || '').includes('meta.mmh-virtual.jp')
        );
        if (!zone) {
            return {
                error: 'no external zone',
                ids: app.teleportManager.teleportZones.map((z) => ({
                    id: z.id,
                    url: z.destinationUrl,
                })),
            };
        }
        app.teleportManager.nearestZone = zone;
        return { ok: true, id: zone.id, url: zone.destinationUrl, label: zone.label };
    });

    if (zoneInfo.error) {
        console.error(JSON.stringify(zoneInfo, null, 2));
        await browser.close();
        process.exit(1);
    }

    const nav = page.waitForURL(/meta\.mmh-virtual\.jp/i, { timeout: 60000 });
    await page.evaluate(() => {
        const app = window.__tenantE2E.getMetaverseApp();
        app.updateTeleportZones();
        const zone = app.teleportManager.teleportZones.find((z) => z.id === 'portal-meta-lobby');
        app.teleportManager.nearestZone = zone;
        app.teleportManager._runInteractAfterAircraftCheck();
    });
    await nav;

    const finalUrl = page.url();
    await page.screenshot({
        path: path.join(ART, 'staging-after-meta-navigation.png'),
        fullPage: false,
    });
    await import('node:fs/promises').then((fs) =>
        fs.writeFile(
            path.join(ART, 'staging-after-meta-navigation.url.txt'),
            `${finalUrl}\n`,
            'utf8'
        )
    );

    console.log(JSON.stringify({ zoneInfo, finalUrl, startedFrom: STAGING }, null, 2));
    await browser.close();
}

main().catch((e) => {
    console.error(e);
    process.exit(1);
});