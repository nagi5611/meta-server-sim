// addons/aircraft/test/flight-physics.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeAircraftPhysicsFromWorld } from '../client/aircraft-physics-defaults.js';
import { mergeEasyAircraftPhysicsFromWorld } from '../client/aircraft-physics-easy-defaults.js';
import { simulateFlightStep } from '../lib/flight-step.js';

test('mergeAircraftPhysicsFromWorld reflects custom thrust', () => {
    const custom = mergeAircraftPhysicsFromWorld({ maxThrustSpeed: 120 });
    const defaults = mergeAircraftPhysicsFromWorld(null);
    assert.equal(custom.maxThrustSpeed, 120);
    assert.notEqual(custom.maxThrustSpeed, defaults.maxThrustSpeed);
});

test('simulateFlightStep climbs with throttle on ground run', () => {
    const physics = mergeEasyAircraftPhysicsFromWorld(null);
    let state = { y: 2, speed: 0, throttle: 0, onGround: true, pitch: 0 };
    for (let i = 0; i < 120; i++) {
        state = simulateFlightStep(state, physics, { throttleInput: 1, pitchInput: 0.2, dt: 0.05 });
    }
    assert.ok(state.speed > 5, 'should accelerate on throttle');
    assert.ok(state.y >= 2, 'altitude should not drop on takeoff roll');
});

test('simulateFlightStep stalls when speed below stallSpeed in air', () => {
    const physics = mergeAircraftPhysicsFromWorld({ stallSpeed: 55, maxThrustSpeed: 80 });
    let state = { y: 50, speed: 20, throttle: 0, onGround: false, pitch: 0.3 };
    const before = state.y;
    for (let i = 0; i < 30; i++) {
        state = simulateFlightStep(state, physics, { throttleInput: 0, pitchInput: 0.5, dt: 0.05 });
    }
    assert.ok(state.y < before, 'stall should lose altitude with high pitch and low speed');
});