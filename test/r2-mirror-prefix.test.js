// test/r2-mirror-prefix.test.js — meta/models → テナント models ミラー

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    META_MODELS_SOURCE_PREFIX,
    decideMirrorAction,
    mapMetaModelsKeyToTenantModelsKey,
    normalizeEtag,
} from '../lib/r2/r2-mirror-prefix.js';
import { _resetEnvConfigCacheForTests } from '../lib/platform-env-config.js';
import { resetS3Client } from '../lib/r2/r2-s3-client.js';

describe('r2-mirror-prefix', () => {
    const originalPrefix = process.env.R2_KEY_PREFIX;

    beforeEach(() => {
        process.env.R2_KEY_PREFIX = 'metaverse';
        _resetEnvConfigCacheForTests();
        resetS3Client();
    });

    afterEach(() => {
        if (originalPrefix === undefined) {
            delete process.env.R2_KEY_PREFIX;
        } else {
            process.env.R2_KEY_PREFIX = originalPrefix;
        }
        _resetEnvConfigCacheForTests();
        resetS3Client();
    });

    it('mapMetaModelsKeyToTenantModelsKey transforms meta/models/foo.glb', () => {
        const dest = mapMetaModelsKeyToTenantModelsKey('meta-server', `${META_MODELS_SOURCE_PREFIX}foo.glb`);
        assert.equal(dest, 'metaverse/tenants/meta-server/models/foo.glb');
    });

    it('mapMetaModelsKeyToTenantModelsKey preserves nested paths', () => {
        const dest = mapMetaModelsKeyToTenantModelsKey('meta-server', `${META_MODELS_SOURCE_PREFIX}props/chair.glb`);
        assert.equal(dest, 'metaverse/tenants/meta-server/models/props/chair.glb');
    });

    it('mapMetaModelsKeyToTenantModelsKey skips directory markers', () => {
        assert.equal(mapMetaModelsKeyToTenantModelsKey('meta-server', `${META_MODELS_SOURCE_PREFIX}props/`), null);
    });

    it('normalizeEtag strips quotes', () => {
        assert.equal(normalizeEtag('"abc"'), 'abc');
    });

    it('decideMirrorAction respects no-overwrite when dest differs', () => {
        const action = decideMirrorAction(
            { etag: '"a"', size: 10 },
            { etag: '"b"', size: 10 }
        );
        assert.equal(action, 'skip-exists');
    });

    it('decideMirrorAction copies when dest missing', () => {
        assert.equal(decideMirrorAction(null, { etag: '"b"', size: 1 }), 'copy');
    });

    it('decideMirrorAction skips identical dest', () => {
        assert.equal(
            decideMirrorAction({ etag: '"same"', size: 42 }, { etag: '"same"', size: 42 }),
            'skip-identical'
        );
    });
});