// addons/aircraft/test/aircraft-ground-probe.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clampVerticalDrop, resolveGroundMinY } from '../lib/aircraft-ground-probe.js';

test('resolveGroundMinY reuses last floor when ray misses below', () => {
    const r = resolveGroundMinY(null, 2.0, 0.5, -1);
    assert.equal(r.minY, 2.0);
    assert.equal(r.lastGroundMinY, 2.0);
});

test('clampVerticalDrop limits descent per frame on ground', () => {
    const dy = clampVerticalDrop(-0.5, { headroom: 0.1 }, 0.02);
    assert.ok(dy > -0.1);
    assert.ok(dy < 0);
});