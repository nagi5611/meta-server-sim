// test/tenant-asset-cache-headers.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    applyTenantAssetDiskCacheHeaders,
    isTenantImmutableDiskCacheAsset,
    tenantAssetCacheMaxAgeSec,
} from '../lib/tenant-asset-cache-headers.js';

describe('tenant-asset-cache-headers', () => {
    it('treats .glb as immutable long-cache asset', () => {
        assert.equal(isTenantImmutableDiskCacheAsset('lobby.glb'), true);
        assert.equal(isTenantImmutableDiskCacheAsset('x.png'), false);
        assert.equal(tenantAssetCacheMaxAgeSec('a.glb'), 2_592_000);
    });

    it('sets public max-age and immutable for GLB', () => {
        const headers = {};
        const res = { setHeader(k, v) { headers[k] = v; } };
        applyTenantAssetDiskCacheHeaders(res, 'models/lobby.glb', { etag: '"abc"' });
        assert.match(headers['Cache-Control'], /public/);
        assert.match(headers['Cache-Control'], /immutable/);
        assert.match(headers['Cache-Control'], /max-age=/);
        assert.equal(headers.ETag, '"abc"');
    });
});
