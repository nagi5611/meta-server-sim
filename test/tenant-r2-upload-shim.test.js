// test/tenant-r2-upload-shim.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { shouldUseServerGlbUpload } from '../public/js/tenant-r2-upload-shim.js';

describe('tenant-r2-upload-shim', () => {
    it('shouldUseServerGlbUpload is true for .glb without skipTextureResize', () => {
        const form = new FormData();
        const file = new File([new Uint8Array([1])], 'newshool_all_midium.glb', {
            type: 'model/gltf-binary',
        });
        form.append('model', file);
        assert.equal(shouldUseServerGlbUpload(form, file), true);
    });

    it('shouldUseServerGlbUpload is true for .glb even when skipTextureResize=1', () => {
        const form = new FormData();
        const file = new File([new Uint8Array([1])], 'model.glb', { type: 'model/gltf-binary' });
        form.append('model', file);
        form.append('skipTextureResize', '1');
        assert.equal(shouldUseServerGlbUpload(form, file), true);
    });

    it('shouldUseServerGlbUpload is false for non-glb', () => {
        const form = new FormData();
        const file = new File([new Uint8Array([1])], 'mesh.obj', { type: 'text/plain' });
        form.append('model', file);
        assert.equal(shouldUseServerGlbUpload(form, file), false);
    });
});
