// test/fds-smoke-depth-pass.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { FdsSmokeDepthPass } from '../public/js/fds/fds-smoke-depth-pass.js';

describe('FdsSmokeDepthPass', () => {
    it('setSize creates depth texture', () => {
        const pass = new FdsSmokeDepthPass();
        pass.setSize(320, 240);
        const tex = pass.getDepthTexture();
        assert.ok(tex);
        assert.equal(tex.image.width, 320);
        assert.equal(tex.image.height, 240);
        pass.dispose();
        assert.equal(pass.getDepthTexture(), null);
    });

    it('setSize with same dimensions reuses target', () => {
        const pass = new FdsSmokeDepthPass();
        pass.setSize(100, 100);
        const first = pass.getDepthTexture();
        pass.setSize(100, 100);
        assert.equal(pass.getDepthTexture(), first);
        pass.dispose();
    });
});
