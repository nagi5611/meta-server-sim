import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeAnnouncementLocale } from '../src/announcement-i18n.js';
import {
    sourceOnlyAnnouncementI18n,
    translateAnnouncementFields,
} from '../src/announcement-translator.js';

test('normalizeAnnouncementLocale maps browser tags', () => {
    assert.equal(normalizeAnnouncementLocale('zh-TW'), 'zh-TW');
    assert.equal(normalizeAnnouncementLocale('en-US'), 'en');
    assert.equal(normalizeAnnouncementLocale(''), 'ja');
});

test('translateAnnouncementFields skips Gemini when API key absent', async () => {
    let fetchCalls = 0;
    const fetchImpl = async () => {
        fetchCalls += 1;
        return new Response('{}', { status: 200 });
    };
    const result = await translateAnnouncementFields({
        sourceLocale: 'ja',
        title: 'テスト',
        body: '本文',
        fetchImpl,
    });
    assert.equal(fetchCalls, 0);
    assert.equal(result.translated, false);
    assert.deepEqual(result.i18n, sourceOnlyAnnouncementI18n('ja', 'テスト', '本文'));
});

test('sourceOnlyAnnouncementI18n stores source locale only', () => {
    const map = sourceOnlyAnnouncementI18n('en', 'Hi', 'Body');
    assert.deepEqual(map, { en: { title: 'Hi', body: 'Body' } });
});

test('translateAnnouncementFields title-only stores empty body in i18n', async () => {
    const result = await translateAnnouncementFields({
        sourceLocale: 'ja',
        title: 'タイトルのみ',
        body: '',
    });
    assert.equal(result.translated, false);
    assert.deepEqual(result.i18n, sourceOnlyAnnouncementI18n('ja', 'タイトルのみ', ''));
});