// addons/aircraft/test/aircraft-scenario-runner.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { controlsToKeyState } from '../client/aircraft-scenario-runner.js';

test('controlsToKeyState hard mode maps thrust to throttleUp', () => {
    const keys = controlsToKeyState({ thrust: 1, yaw: 0, pitch: 0, roll: 0 }, 'hard');
    assert.equal(keys.throttleUp, true);
    assert.equal(keys.forward, undefined);
});

test('controlsToKeyState easy mode maps thrust to forward', () => {
    const keys = controlsToKeyState({ thrust: 1, yaw: 0, pitch: 0, roll: 0 }, 'easy');
    assert.equal(keys.forward, true);
    assert.equal(keys.throttleUp, undefined);
});