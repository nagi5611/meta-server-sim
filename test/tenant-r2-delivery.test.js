// test/tenant-r2-delivery.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldRedirectTenantAssetsToR2 } from '../lib/r2/tenant-r2-delivery.js';

describe('tenant-r2-delivery', () => {
    it('shouldRedirectTenantAssetsToR2 is false for browser-safe proxy delivery', () => {
        assert.equal(shouldRedirectTenantAssetsToR2(), false);
    });
});
