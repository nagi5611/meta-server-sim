#!/usr/bin/env node
// scripts/ws8-lobby-meta-server-playwright.mjs — ロビー画面に meta-server テナントが表示されるか

import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const lobbyUrl = process.env.WS8_LOBBY_PUBLIC_URL || 'https://m.mmh-virtual.jp/';
const art = process.env.ARTIFACT_DIR || '/tmp/ws8-artifacts';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ ignoreHTTPSErrors: true, viewport: { width: 1400, height: 900 } });
await page.goto(lobbyUrl, { waitUntil: 'domcontentloaded', timeout: 120_000 });
await page.waitForTimeout(5000);
const body = await page.locator('body').innerText();
const hasMeta =
    /meta-server/i.test(body) ||
    (await page.locator('a[href*="meta-server"]').count()) > 0;
if (!hasMeta) {
    console.error('[lobby-e2e] meta-server not found in lobby UI');
    process.exitCode = 1;
}
await page.screenshot({ path: path.join(art, 'lobby-meta-server-listing.png'), fullPage: true });
fs.writeFileSync(path.join(art, 'lobby-entry.url.txt'), `${lobbyUrl}\n`);
await browser.close();
console.log(`[lobby-e2e] meta-server visible=${hasMeta}`);