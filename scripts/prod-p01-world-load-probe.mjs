#!/usr/bin/env node
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const OUT = '/opt/cursor/artifacts';
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true, args: ['--use-gl=angle', '--enable-webgl'] });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

const net = [];
page.on('response', async (res) => {
    const u = res.url();
    if (/\/api\/worlds|lobby\.glb|\/models\//i.test(u)) {
        net.push({ url: u, status: res.status() });
    }
});
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));

await page.addInitScript(() => {
    window.__TENANT_E2E_HARNESS__ = '1';
    document.documentElement.dataset.e2eHarness = '1';
    localStorage.setItem('metaverse-control-scheme', 'keyboard');
    localStorage.setItem('username', `Probe-${Date.now()}`);
});

await page.goto('https://sim.mmh-virtual.jp/P-01/', { waitUntil: 'domcontentloaded', timeout: 120000 });
const gate = page.locator('#tenant-login-enter-btn');
if (await gate.isVisible({ timeout: 5000 }).catch(() => false)) await gate.click();

for (let i = 0; i < 180; i++) {
    if (await page.evaluate(() => document.documentElement.dataset.tenantMetaverseReady === 'true')) break;
    await page.waitForTimeout(1000);
}

const diag = await page.evaluate(async () => {
    const direct = await fetch('/api/worlds');
    const tenant = await fetch('/P-01/api/worlds');
    const shim = typeof window.__tenantFetchShimInstalled !== 'undefined';
    const app = window.__tenantMetaverseApp;
    const wm = app?.worldManager;
    const viewDistanceM = window.__tenantMetaverseProbe?.sceneManager?.graphicsOptions?.viewDistanceM;
    return {
        viewDistanceM,
        shimInstalled: Boolean(window.__tenantFetchShimInstalled),
        directWorldsStatus: direct.status,
        directWorldsKeys: direct.ok ? Object.keys(await direct.json()).slice(0, 5) : [],
        tenantWorldsStatus: tenant.status,
        tenantWorldsHasLobby: tenant.ok ? Boolean((await tenant.json()).lobby) : false,
        wmWorldKeys: wm?.worlds ? Object.keys(wm.worlds) : null,
        currentWorldId: wm?.getCurrentWorldId?.() ?? null,
        modelCount: wm?.getCurrentWorld?.()?.models?.length ?? null,
        sceneChildren: window.__tenantMetaverseApp?.sceneManager?.getScene?.()?.children?.length ?? null,
    };
});

await page.screenshot({ path: `${OUT}/p01-world-probe-after-wait.png`, fullPage: false });
fs.writeFileSync(`${OUT}/p01-world-probe.json`, JSON.stringify({ diag, net, logs: logs.filter((l) => /world|World|GLTF|model|lobby/i.test(l)).slice(0, 40) }, null, 2));
console.log(JSON.stringify(diag, null, 2));
await browser.close();