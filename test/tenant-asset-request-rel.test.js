// test/tenant-asset-request-rel.test.js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeTenantAssetRequestRel } from '../lib/tenant-asset-request-rel.js';

describe('normalizeTenantAssetRequestRel', () => {
    it('decodes percent-encoded Japanese filename segments', () => {
        const encoded =
            '%E4%B8%80%E8%88%AC_%E3%83%9D%E3%82%B9%E3%82%BF%E3%83%BC%E5%8E%9F%E7%A8%BF_%E6%9D%BE%E5%B1%B1%E5%8D%97%EF%BC%88%E7%89%A9%E7%90%86%EF%BC%91%EF%BC%89.pdf';
        const rel = normalizeTenantAssetRequestRel(`/${encoded}`);
        assert.equal(rel, '一般_ポスター原稿_松山南（物理１）.pdf');
    });

    it('passes through ASCII filenames unchanged', () => {
        assert.equal(normalizeTenantAssetRequestRel('/mainschool.pdf'), 'mainschool.pdf');
    });

    it('rejects parent directory segments after decode', () => {
        assert.equal(normalizeTenantAssetRequestRel('/%2e%2e/secret.pdf'), null);
    });
});