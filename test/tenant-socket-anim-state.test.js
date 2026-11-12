import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlayerAnimState } from '../lib/player-anim-state.js';

describe('normalizePlayerAnimState', () => {
    it('maps dash to run', () => {
        assert.equal(normalizePlayerAnimState('dash'), 'run');
        assert.equal(normalizePlayerAnimState('DASH'), 'run');
    });

    it('passes through known states', () => {
        assert.equal(normalizePlayerAnimState('walk'), 'walk');
        assert.equal(normalizePlayerAnimState('idle'), 'idle');
    });

    it('falls back unknown to idle', () => {
        assert.equal(normalizePlayerAnimState('dance'), 'idle');
    });
});
