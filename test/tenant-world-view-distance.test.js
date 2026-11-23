// test/tenant-world-view-distance.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureViewDistanceCoversWorldModels } from '../public/js/tenant-world-view-distance.js';

test('raises viewDistanceM when spawn is far from scaled lobby model (P-01 shape)', () => {
    const sceneManager = { graphicsOptions: { viewDistanceM: 50 } };
    const world = {
        spawnPoint: { x: 207, y: 1, z: 5 },
        models: [
            {
                path: 'models/lobby.glb',
                position: { x: 0, y: -4.4367, z: -1.6087 },
                scale: { x: 20, y: 20, z: 20 },
            },
        ],
    };
    const next = ensureViewDistanceCoversWorldModels(sceneManager, world);
    assert.ok(next > 250, `expected >250m, got ${next}`);
    assert.equal(sceneManager.graphicsOptions.viewDistanceM, next);
});

test('does not shrink an already larger viewDistanceM', () => {
    const sceneManager = { graphicsOptions: { viewDistanceM: 500 } };
    const world = {
        spawnPoint: { x: 0, y: 0, z: 0 },
        models: [{ path: 'models/a.glb', position: { x: 10, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }],
    };
    ensureViewDistanceCoversWorldModels(sceneManager, world);
    assert.equal(sceneManager.graphicsOptions.viewDistanceM, 500);
});