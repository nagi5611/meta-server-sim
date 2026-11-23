// addons/aircraft/test/aircraft-scenario-schema.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateAircraftScenario } from '../lib/aircraft-scenario-schema.js';
import { buildAircraftScenarioReport, evaluateCheckpoint } from '../lib/aircraft-scenario-report.js';

test('validateAircraftScenario accepts minimal straight scenario', () => {
    const res = validateAircraftScenario({
        id: 't1',
        name: 'test',
        steps: [{ durationSec: 1, controls: { thrust: 1, yaw: 0, pitch: 0, roll: 0 } }],
        checkpoints: [
            {
                atTimeSec: 1,
                expect: { minAltitudeGain: 0 },
                tolerance: { altitudeM: 1 },
            },
        ],
    });
    assert.equal(res.ok, true);
});

test('evaluateCheckpoint deltaPosition uses start sample', () => {
    const start = {
        tSec: 0,
        position: { x: 0, y: 1, z: 0 },
        quaternion: { x: 0, y: 0, z: 0, w: 1 },
        headingDeg: 0,
        speedHorizontal: 0,
        verticalSpeed: 0,
    };
    const end = {
        ...start,
        tSec: 5,
        position: { x: 0, y: 1, z: -20 },
    };
    const cp = {
        atTimeSec: 5,
        expect: { deltaPosition: { x: 0, y: 0, z: -18 } },
        tolerance: { positionM: 5 },
    };
    const r = evaluateCheckpoint(cp, end, start);
    assert.equal(r.pass, true);
    const report = buildAircraftScenarioReport(
        { id: 't', version: 1, name: 't', controlMode: 'easy', sampleIntervalMs: 100, steps: [], checkpoints: [cp] },
        [start, end]
    );
    assert.equal(report.pass, true);
});