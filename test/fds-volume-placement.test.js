// test/fds-volume-placement.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
    buildFdsVolumeMirrorSign,
    buildFdsVolumeRotationMatrices,
    computeFdsVolumePlacement,
    normalizeFdsVolumeMirror,
} from '../public/js/fds/fds-volume-placement.js';

const sampleManifest = {
    dims: [3, 3, 3],
    bounds: { x: [0, 2], y: [0, 2], z: [0, 2] },
};

describe('fds-volume-placement', () => {
    it('buildFdsVolumeRotationMatrices is identity at zero rotation', () => {
        const { rotation, rotationInverse } = buildFdsVolumeRotationMatrices({ x: 0, y: 0, z: 0 });
        const identity = new THREE.Matrix3();
        assert.ok(rotation.equals(identity));
        assert.ok(rotationInverse.equals(identity));
    });

    it('buildFdsVolumeRotationMatrices inverts rotation', () => {
        const { rotation, rotationInverse } = buildFdsVolumeRotationMatrices({ x: 0, y: 90, z: 0 });
        const product = new THREE.Matrix3().multiplyMatrices(rotation, rotationInverse);
        const identity = new THREE.Matrix3();
        for (let i = 0; i < 9; i++) {
            const expected = i % 4 === 0 ? 1 : 0;
            assert.ok(Math.abs(product.elements[i] - expected) < 1e-5);
        }
    });

    it('computeFdsVolumePlacement includes rotation matrices', () => {
        const placement = computeFdsVolumePlacement(sampleManifest, {
            position: { x: 1, y: 2, z: 3 },
            rotation: { x: 0, y: 45, z: 0 },
            scale: 2,
        });
        assert.equal(placement.volumeOrigin.x, 1);
        assert.equal(placement.volumeOrigin.y, 2);
        assert.equal(placement.volumeOrigin.z, 3);
        assert.ok(placement.volumeRotation);
        assert.ok(placement.volumeRotationInverse);
        assert.notEqual(placement.volumeRotation.elements[0], 1);
    });

    it('normalizeFdsVolumeMirror coerces truthy flags only', () => {
        assert.deepEqual(normalizeFdsVolumeMirror({ x: true, y: 1, z: 'yes' }), {
            x: true,
            y: false,
            z: false,
        });
    });

    it('buildFdsVolumeMirrorSign maps mirror flags to -1', () => {
        const sign = buildFdsVolumeMirrorSign({ x: true, y: false, z: true });
        assert.equal(sign.x, -1);
        assert.equal(sign.y, 1);
        assert.equal(sign.z, -1);
    });

    it('computeFdsVolumePlacement includes mirror sign', () => {
        const placement = computeFdsVolumePlacement(sampleManifest, {
            mirror: { x: true, y: false, z: true },
        });
        assert.equal(placement.volumeMirrorSign.x, -1);
        assert.equal(placement.volumeMirrorSign.y, 1);
        assert.equal(placement.volumeMirrorSign.z, -1);
    });
});
