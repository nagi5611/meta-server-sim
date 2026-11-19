import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import {
    ANN_PAGE_SIZE,
    announcementPageCount,
    announcementPageSlice,
    clampAnnouncementPage,
} from '../public/lobby-announcements.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

test('announcement paging uses page size 5', () => {
    assert.equal(ANN_PAGE_SIZE, 5);
    const items = Array.from({ length: 12 }, (_, i) => ({ id: String(i), title: `t${i}` }));
    assert.equal(announcementPageCount(items.length), 3);
    const page1 = announcementPageSlice(items, 1);
    assert.equal(page1.pageIndex, 1);
    assert.equal(page1.slice.length, 5);
    assert.equal(page1.slice[0].title, 't5');
    assert.equal(announcementPageSlice(items, 99).pageIndex, 2);
});

test('clampAnnouncementPage keeps index in range', () => {
    assert.equal(clampAnnouncementPage(-2, 4), 0);
    assert.equal(clampAnnouncementPage(2, 4), 2);
    assert.equal(clampAnnouncementPage(9, 4), 3);
    assert.equal(clampAnnouncementPage(1, 0), 0);
});

test('lobby index ships pager markup and layout hooks', () => {
    const html = readFileSync(join(publicDir, 'index.html'), 'utf8');
    assert.match(html, /id="announcement-pager"/);
    assert.match(html, /id="ann-pager-prev"/);
    assert.match(html, /data-i18n="lobby\.joinCodeTitle"/);
    assert.doesNotMatch(html, /joinByCode|otherWorlds/);
});

test('lobby index includes accessible public footer', () => {
    const html = readFileSync(join(publicDir, 'index.html'), 'utf8');
    const css = readFileSync(join(publicDir, 'lobby.css'), 'utf8');
    assert.match(html, /<footer class="site-footer"/);
    assert.match(html, /data-i18n="lobby\.footerOrg"/);
    assert.match(html, /data-i18n="lobby\.footerContactLabel"/);
    assert.match(html, /data-i18n="lobby\.footerSiteLabel"/);
    assert.match(html, /href="mailto:developer@mmh-virtual\.jp"/);
    assert.match(html, /href="https:\/\/mmh-virtual\.jp"/);
    assert.match(html, /rel="noopener noreferrer"/);
    assert.match(css, /\.site-footer\b/);
});

test('locales define announcement pager strings for ja, zh-CN, zh-TW, en', () => {
    const locales = JSON.parse(readFileSync(join(publicDir, 'locales.json'), 'utf8'));
    for (const loc of ['ja', 'zh-CN', 'zh-TW', 'en']) {
        assert.ok(locales[loc]['lobby.announcementsPagePrev'], loc);
        assert.ok(locales[loc]['lobby.announcementsPageNext'], loc);
        assert.ok(locales[loc]['lobby.announcementsPageGoto'], loc);
        assert.ok(locales[loc]['lobby.footerOrg'], loc);
        assert.ok(locales[loc]['lobby.footerContactLabel'], loc);
        assert.ok(locales[loc]['lobby.footerSiteLabel'], loc);
        assert.ok(locales[loc]['lobby.footerContactAria'], loc);
        assert.ok(locales[loc]['lobby.footerSiteAria'], loc);
    }
});

test('lobby.css keeps top row from stretching join panel', () => {
    const css = readFileSync(join(publicDir, 'lobby.css'), 'utf8');
    assert.match(css, /\.lobby-top-row[\s\S]*align-items:start/);
    assert.match(css, /\.join-code-panel\{align-self:start/);
});