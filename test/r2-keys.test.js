// test/r2-keys.test.js — R2 キー命名のユニットテスト

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toR2Key, sanitizeFilename, isValidRelativePath, listPrefix } from '../lib/r2/r2-keys.js';

describe('r2-keys', () => {
    it('toR2Key generates tenant-scoped keys', () => {
        const key = toR2Key('P-04', 'models', 'building.glb');
        assert.match(key, /tenants\/P-04\/models\/building\.glb$/);
    });

    it('sanitizeFilename strips path separators', () => {
        assert.equal(sanitizeFilename('../evil.glb'), 'evil.glb');
    });

    it('isValidRelativePath rejects traversal', () => {
        assert.equal(isValidRelativePath('foo/bar'), true);
        assert.equal(isValidRelativePath('../secret'), false);
    });

    it('listPrefix ends with slash', () => {
        const prefix = listPrefix('P-01', 'models', '');
        assert.ok(prefix.endsWith('/'));
        assert.ok(prefix.includes('tenants/P-01/models/'));
    });

    it('simulations store is valid', () => {
        const key = toR2Key('P-01', 'simulations', 'fugaku-prod01/manifest.json');
        assert.match(key, /tenants\/P-01\/simulations\/fugaku-prod01\/manifest\.json$/);
    });
});
