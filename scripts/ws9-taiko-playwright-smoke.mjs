#!/usr/bin/env node
// scripts/ws9-taiko-playwright-smoke.mjs — 太鼓 UI 描画スモーク（静的 HTML + CSS）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = process.env.ARTIFACT_DIR || '/opt/cursor/artifacts';
const overlayMatch = fs
    .readFileSync(path.join(root, 'public/tenant.html'), 'utf8')
    .match(/<div id="taiko-game-overlay"[\s\S]*?<\/div>\s*\n\s*<canvas/);
const overlayHtml = overlayMatch
    ? overlayMatch[0].replace(/\s*<canvas[\s\S]*/, '')
    : '<div id="taiko-game-overlay"></div>';
const css = fs.readFileSync(path.join(root, 'public/css/tenant-taiko.css'), 'utf8');

const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
${overlayHtml}
<script>
document.getElementById('taiko-game-overlay').style.display = 'flex';
document.getElementById('taiko-song-select').style.display = 'flex';
const ul = document.getElementById('taiko-chart-list');
['todoroki2026','demo'].forEach((id) => {
  const li = document.createElement('li');
  li.textContent = id;
  ul.appendChild(li);
});
</script></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'load' });
await page.screenshot({ path: path.join(artifactDir, 'tenant-taiko-song-select.png'), fullPage: true });
await page.evaluate(() => {
    document.getElementById('taiko-song-select').style.display = 'none';
    document.getElementById('taiko-game-container').style.display = 'block';
    const notes = document.getElementById('taiko-notes');
    ['don', 'ka', 'don'].forEach((type, i) => {
        const el = document.createElement('div');
        el.className = `taiko-note taiko-note-${type}`;
        el.style.left = `${120 + i * 80}px`;
        notes.appendChild(el);
    });
    document.getElementById('taiko-score').textContent = '1200';
    document.getElementById('taiko-score-max').textContent = '3000';
});
await page.screenshot({ path: path.join(artifactDir, 'tenant-taiko-play-smoke.png'), fullPage: true });
await browser.close();
console.log('wrote tenant-taiko-song-select.png and tenant-taiko-play-smoke.png');