// test/tenant-fds-smoke-playback.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFdsPlaybackIntervalSeconds } from '../public/js/tenant-fds-smoke-playback.js';

describe('tenant-fds-smoke-playback', () => {
    it('resolveFdsPlaybackIntervalSeconds rejects non-finite and zero intervals', () => {
        assert.equal(resolveFdsPlaybackIntervalSeconds({ framesPerSecond: 1 }), 1);
        assert.equal(resolveFdsPlaybackIntervalSeconds({ secondsPerFrame: 0.1 }), 0.1);
        assert.ok(resolveFdsPlaybackIntervalSeconds({ secondsPerFrame: 0 }) >= 1);
        assert.ok(resolveFdsPlaybackIntervalSeconds({ framesPerSecond: 0 }) >= 1);
        assert.ok(Number.isFinite(resolveFdsPlaybackIntervalSeconds({ secondsPerFrame: NaN })));
    });
});