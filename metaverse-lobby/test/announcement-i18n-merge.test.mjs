import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    mergeAnnouncementI18nOverrides,
    parseAdminAnnouncementI18n,
} from '../src/announcement-i18n.js';

test('mergeAnnouncementI18nOverrides prefers admin title overrides', () => {
    const base = {
        ja: { title: 'メンテ', body: '' },
        en: { title: 'Maintenance', body: '' },
        'zh-CN': { title: '维护', body: '' },
        'zh-TW': { title: '維護', body: '' },
    };
    const merged = mergeAnnouncementI18nOverrides(base, {
        en: { title: 'Custom EN title' },
    });
    assert.equal(merged.ja.title, 'メンテ');
    assert.equal(merged.en.title, 'Custom EN title');
});

test('parseAdminAnnouncementI18n normalizes locale keys', () => {
    const parsed = parseAdminAnnouncementI18n({
        ja: { title: 'あ' },
        'zh-cn': { title: '简' },
    });
    assert.ok(parsed);
    assert.equal(parsed.ja.title, 'あ');
    assert.equal(parsed['zh-CN'].title, '简');
});