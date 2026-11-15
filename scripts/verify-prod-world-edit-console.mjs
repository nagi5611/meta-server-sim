import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const mcp = path.resolve(process.cwd(), '../metaverse-simple/mcp/metaverse-admin/.env.mcp');
const env = fs.readFileSync(mcp, 'utf8');
const pass = Buffer.from(env.match(/^META_ADMIN_PASSWORD_B64=(.*)$/m)[1].trim(), 'base64').toString('utf8');

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
    baseURL: 'https://sim.mmh-virtual.jp',
    httpCredentials: { username: 'admin', password: pass },
});
const page = await ctx.newPage();
const logs = [];
const failedUrls = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('response', (r) => {
    if (r.url().includes('manifest.json')) {
        logs.push(`[res] ${r.status()} ${r.url()}`);
    }
    if (r.status() >= 400) {
        failedUrls.push(`${r.status()} ${r.url()}`);
    }
});

await page.goto('/admin/tenant/P-01/world-edit', { timeout: 120_000 });
for (let i = 0; i < 24; i++) {
    await page.waitForTimeout(5_000);
    const c = await page.locator('#world-list .item').count();
    if (c > 0) break;
}
const count = await page.locator('#world-list .item').count();
console.log('world_list_items', count);

const school = page.locator('#world-list .item[data-id="school"]');
if (await school.count()) {
    await school.click();
} else if (count > 0) {
    await page.locator('#world-list .item').first().click();
}

await page.waitForTimeout(12_000);

const previewFail = logs.filter((l) => l.includes('[TenantWorldEditFdsSmokePreview] load failed'));
const manifest404 = failedUrls.filter((u) => u.includes('manifest.json'));
const manifest200 = logs.filter((l) => l.startsWith('[res] 200') && l.includes('manifest.json'));
console.log('manifest_fetch_200', manifest200.length);
console.log('manifest_fetch_404', manifest404.length);
console.log('preview_load_failed', previewFail.length);
for (const u of failedUrls.slice(0, 10)) console.log('fail', u);

await browser.close();
process.exit(previewFail.length > 0 || manifest404.length > 0 ? 1 : 0);