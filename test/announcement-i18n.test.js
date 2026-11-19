import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickAnnouncementText } from '../metaverse-lobby/src/announcement-i18n.js';

test('pickAnnouncementText prefers locale bucket then falls back', () => {
    const i18n = {
        ja: { title: '日本語', body: '本文' },
        en: { title: 'English', body: 'Body' },
    };
    assert.deepEqual(
        pickAnnouncementText(i18n, 'en', { title: 'fallback', body: 'fb' }),
        { title: 'English', body: 'Body' },
    );
    assert.deepEqual(
        pickAnnouncementText(i18n, 'zh-CN', { title: 'fallback', body: 'fb' }),
        { title: 'fallback', body: 'fb' },
    );
});