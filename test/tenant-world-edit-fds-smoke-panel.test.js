// test/tenant-world-edit-fds-smoke-panel.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectFdsWorldSnapshotFromEditGroup } from '../public/js/tenant-world-edit-fds-snapshot.js';

describe('tenant-world-edit-fds-smoke-panel', () => {
    it('collectFdsWorldSnapshotFromEditGroup maps editGroup transforms', () => {
        const editGroup = {
            children: [
                {
                    position: { x: 1, y: 2, z: 3 },
                    rotation: { x: 0, y: Math.PI / 2, z: 0 },
                    scale: { x: 2 },
                    userData: {
                        fdsSmokeConfig: {
                            id: 'smoke-a',
                            manifest: 'simulations/a/manifest.json',
                        },
                    },
                },
                {
                    position: { x: 4, y: 5, z: 6 },
                    userData: {
                        fdsSmokeButtonConfig: {
                            id: 'btn-1',
                            fdsSmokeId: 'smoke-a',
                            panel: { rotation: { x: 0, y: 0, z: 0 } },
                        },
                    },
                },
            ],
        };

        const snap = collectFdsWorldSnapshotFromEditGroup(editGroup);
        assert.equal(snap.fdsSmokes.length, 1);
        assert.deepEqual(snap.fdsSmokes[0].position, { x: 1, y: 2, z: 3 });
        assert.equal(snap.fdsSmokes[0].rotation.y, 90);
        assert.equal(snap.fdsSmokes[0].scale, 2);
        assert.equal(snap.fdsSmokeButtons.length, 1);
        assert.deepEqual(snap.fdsSmokeButtons[0].position, { x: 4, y: 5, z: 6 });
    });
});
