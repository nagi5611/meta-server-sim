// test/fds-smoke-transfer-policy.test.js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    bytesPerSecondForPartSize,
    clampBytesPerSecond,
    FDS_SMOKE_BYTES_PER_SECOND_MAX,
    FDS_SMOKE_BYTES_PER_SECOND_MIN,
    summarizePartTransferRates,
    FDS_SMOKE_PLAYBACK_STALL_MS,
    FDS_SMOKE_PART_ATLAS_HEAD_LEAD_FRAMES,
    FDS_SMOKE_ATLAS_FRAMES_PER_CHUNK,
    FDS_SMOKE_ATLAS_INITIAL_SYNC_CHUNKS,
} from '../public/js/fds/fds-smoke-transfer-policy.js';

describe('fds-smoke-transfer-policy', () => {
    it('clampBytesPerSecond enforces min/max', () => {
        assert.equal(clampBytesPerSecond(1000), FDS_SMOKE_BYTES_PER_SECOND_MIN);
        assert.equal(clampBytesPerSecond(99_000_000), FDS_SMOKE_BYTES_PER_SECOND_MAX);
        assert.equal(clampBytesPerSecond(8_000_000), 8_000_000);
    });

    it('bytesPerSecondForPartSize targets duration', () => {
        const bps = bytesPerSecondForPartSize(150_000_000, 15);
        assert.ok(bps >= FDS_SMOKE_BYTES_PER_SECOND_MIN);
        assert.ok(bps <= FDS_SMOKE_BYTES_PER_SECOND_MAX);
        assert.equal(bps, Math.ceil(150_000_000 / 15));
    });

    it('summarizePartTransferRates uses median', () => {
        const s = summarizePartTransferRates([100, 200, 300]);
        assert.equal(s.medianPartBytes, 200);
        assert.ok(s.defaultBytesPerSecond >= FDS_SMOKE_BYTES_PER_SECOND_MIN);
    });

    it('playback stall and atlas head lead match harness defaults', () => {
        assert.equal(FDS_SMOKE_PLAYBACK_STALL_MS, 180_000);
        assert.equal(
            FDS_SMOKE_PART_ATLAS_HEAD_LEAD_FRAMES,
            FDS_SMOKE_ATLAS_FRAMES_PER_CHUNK * FDS_SMOKE_ATLAS_INITIAL_SYNC_CHUNKS + 8,
        );
    });
});