// test/platform-planned-restart.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    normalizePlannedRestartDelay,
    normalizePlannedRestartMessage,
    schedulePlannedPlatformRestart,
    cancelPlannedPlatformRestart,
    getPlannedRestartPublicState,
    registerPlannedRestartBroadcast,
} from '../lib/platform-planned-restart.js';

describe('platform-planned-restart', () => {
    it('normalizePlannedRestartDelay rejects too short delay', () => {
        const r = normalizePlannedRestartDelay(0, 1);
        assert.ok('error' in r);
    });

    it('normalizePlannedRestartMessage requires non-empty text', () => {
        const r = normalizePlannedRestartMessage('   ');
        assert.ok('error' in r);
    });

    it('schedulePlannedPlatformRestart broadcasts and exposes state', () => {
        const events = [];
        registerPlannedRestartBroadcast((event, payload) => {
            events.push({ event, payload });
        });
        cancelPlannedPlatformRestart();

        const scheduled = schedulePlannedPlatformRestart({
            delayMs: 60_000,
            message: 'メンテナンスのため再起動します',
        });
        assert.equal(scheduled.message, 'メンテナンスのため再起動します');
        const state = getPlannedRestartPublicState();
        assert.ok(state);
        assert.equal(state.message, scheduled.message);
        assert.equal(events.length, 1);
        assert.equal(events[0].event, 'platform:planned-restart');

        cancelPlannedPlatformRestart();
        assert.equal(getPlannedRestartPublicState(), null);
    });
});
