// test/fds-volume-sampler.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { computeFdsVolumePlacement } from '../public/js/fds/fds-volume-placement.js';
import {
    mirrorVolumeLocalPosition,
    sampleNormalizedSootAtWorld,
    SMOKE_INSIDE_NORMALIZED_THRESHOLD,
} from '../public/js/fds/fds-volume-sampler.js';

const manifest = {
    dims: [2, 2, 2],
    bounds: { x: [0, 1], y: [0, 1], z: [0, 1] },
    valueMax: 10,
};

describe('fds-volume-sampler', () => {
    it('samples normalized soot inside volume', () => {
        const placement = computeFdsVolumePlacement(manifest, {
            position: { x: 0, y: 0, z: 0 },
            scale: 1,
        });
        const data = new Uint8Array(2 * 2 * 2 * 2);
        data[0] = 255;
        const world = new THREE.Vector3(0, 0, 0);
        const value = sampleNormalizedSootAtWorld(manifest, placement, data, 0, world);
        assert.ok(value != null && value > 0.9);
    });

    it('returns null outside volume bounds', () => {
        const placement = computeFdsVolumePlacement(manifest, {
            position: { x: 0, y: 0, z: 0 },
            scale: 1,
        });
        const data = new Uint8Array(2 * 2 * 2);
        const value = sampleNormalizedSootAtWorld(
            manifest,
            placement,
            data,
            0,
            new THREE.Vector3(100, 0, 0),
        );
        assert.equal(value, null);
    });

    it('mirrorLocalPosition flips x when mirror.x', () => {
        const placement = computeFdsVolumePlacement(manifest, {
            mirror: { x: true, y: false, z: false },
        });
        const local = new THREE.Vector3(0, 0, 0);
        const out = new THREE.Vector3();
        mirrorVolumeLocalPosition(local, placement, out);
        assert.ok(out.x > 0);
    });

    it('SMOKE_INSIDE_NORMALIZED_THRESHOLD is small positive', () => {
        assert.ok(SMOKE_INSIDE_NORMALIZED_THRESHOLD > 0 && SMOKE_INSIDE_NORMALIZED_THRESHOLD < 0.01);
    });
});
