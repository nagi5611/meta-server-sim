// test/tenant-external-teleporter.test.js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    collectTeleporterDestinationUrls,
    normalizeExternalTeleporterUrl,
} from '../lib/tenant-external-teleporter.js';

describe('normalizeExternalTeleporterUrl', () => {
    it('accepts https', () => {
        assert.equal(
            normalizeExternalTeleporterUrl('https://meta.mmh-virtual.jp/'),
            'https://meta.mmh-virtual.jp/'
        );
    });
    it('rejects javascript', () => {
        assert.equal(normalizeExternalTeleporterUrl('javascript:alert(1)'), null);
    });
});

describe('collectTeleporterDestinationUrls', () => {
    it('maps model teleporter id to url', () => {
        const map = collectTeleporterDestinationUrls({
            models: [
                {
                    teleporter: {
                        id: 'meta-lobby',
                        destinationUrl: 'https://meta.mmh-virtual.jp/',
                    },
                },
            ],
        });
        assert.equal(map.get('meta-lobby'), 'https://meta.mmh-virtual.jp/');
    });
});