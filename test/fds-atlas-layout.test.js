// test/fds-atlas-layout.test.js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    atlasVoxelIndex,
    computeAtlasResolution,
    computeAtlasTextureSize,
    floatToHalf,
} from '../public/js/fds/fds-atlas-layout.js';

describe('fds-atlas-layout', () => {
    it('computeAtlasResolution matches VolumeRenderer layout', () => {
        const ar = computeAtlasResolution(61);
        assert.equal(ar.x, 4);
        assert.equal(ar.y, 4);
        assert.equal(ar.z, 4);
    });

    it('atlasVoxelIndex is stable for frame 0 origin voxel', () => {
        const volumeResolution = { x: 2, y: 2, z: 2 };
        const atlasResolution = computeAtlasResolution(8);
        const textureSize = computeAtlasTextureSize(volumeResolution, atlasResolution);
        const i0 = atlasVoxelIndex(0, 0, 0, 0, volumeResolution, atlasResolution, textureSize);
        const i1 = atlasVoxelIndex(0, 0, 0, 1, volumeResolution, atlasResolution, textureSize);
        assert.notEqual(i0, i1);
        assert.ok(i0 >= 0);
    });

    it('floatToHalf handles 0 and 1', () => {
        assert.equal(floatToHalf(0), 0);
        assert.ok(floatToHalf(1) > 0);
    });
});