// addons/aircraft/test/aircraft-scenario-matrix-eval.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    evaluateMatrixCase,
    expectedPrimaryFromCalibration,
    extractMatrixMetrics,
} from '../../../lib/aircraft-scenario-matrix-eval.js';

test('expectedPrimaryFromCalibration scales linearly with duration', () => {
    assert.equal(expectedPrimaryFromCalibration(125, 1), 25);
    assert.equal(expectedPrimaryFromCalibration(125, 5), 125);
});

test('evaluateMatrixCase rejects zero motion and wrong slot', () => {
    const bad = evaluateMatrixCase({
        expected: 25,
        actual: 0,
        slotId: 'p01-scenario-a320',
        errors: [],
    });
    assert.equal(bad.pass, false);
    assert.ok(bad.reasons.some((r) => r.includes('zero')));

    const wrongSlot = evaluateMatrixCase({
        expected: 25,
        actual: 26,
        slotId: 'other',
        errors: [],
    });
    assert.equal(wrongSlot.pass, false);
});

test('evaluateMatrixCase accepts within ±20%', () => {
    const ok = evaluateMatrixCase({
        expected: 100,
        actual: 110,
        slotId: 'p01-scenario-a320',
        errors: [],
        prevPrimary: 40,
    });
    assert.equal(ok.pass, true);
});

test('extractMatrixMetrics uses heading for yaw-right', () => {
    const report = {
        slotId: 'p01-scenario-a320',
        pass: true,
        errors: [],
        samples: [
            {
                tSec: 0,
                position: { x: 0, y: 1, z: 0 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 },
                headingDeg: 0,
            },
            {
                tSec: 2,
                position: { x: 0, y: 1, z: 0 },
                quaternion: { x: 0, y: 0, z: 0, w: 1 },
                headingDeg: 40,
            },
        ],
    };
    const m = extractMatrixMetrics(report, 'yaw-right');
    assert.ok(m);
    assert.equal(m.primary, 40);
});