#!/usr/bin/env node
// scripts/ws8-lobby-production-playwright.mjs — 本番ロビー meta-server 表示・入場・共有URL
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const art = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts';
const lobbyUrl = process.env.WS8_LOBBY_PUBLIC_URL || 'https://m.mmh-virtual.jp/';

fs.mkdirSync(art, { recursive: true });

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1400, height: 900 },
    locale: 'ja-JP',
    permissions: ['clipboard-read', 'clipboard-write'],
});
const page = await context.newPage();

await page.goto(lobbyUrl, { waitUntil: 'networkidle', timeout: 120_000 });
const card = page.locator('.card[data-id="tenant-meta-server"]');
await card.waitFor({ timeout: 60_000 });
await page.screenshot({ path: path.join(art, 'lobby-meta-server-card-listing.png'), fullPage: true });

await card.click();
await page.waitForTimeout(2500);
await page.screenshot({ path: path.join(art, 'lobby-meta-server-enter-join.png'), fullPage: true });

await page.goto(lobbyUrl, { waitUntil: 'networkidle', timeout: 120_000 });
const card2 = page.locator('.card[data-id="tenant-meta-server"]');
await card2.locator('.card-menu-btn').click();
await page.getByRole('menuitem', { name: '共有URLをコピー' }).click();
await page.waitForTimeout(800);

const clip = await page.evaluate(async () => {
    try {
        return await navigator.clipboard.readText();
    } catch {
        return '';
    }
});
fs.writeFileSync(path.join(art, 'lobby-share-url.txt'), `${clip}\n`);
if (!clip.includes('/join/meta-server')) {
    throw new Error(`clipboard missing /join/meta-server: ${clip}`);
}

const joinPage = await context.newPage();
await joinPage.goto(clip, { waitUntil: 'networkidle', timeout: 120_000 });
await joinPage.screenshot({ path: path.join(art, 'lobby-join-meta-server-page.png'), fullPage: true });

await browser.close();
console.log('[ws8-lobby-e2e] ok', { clip });