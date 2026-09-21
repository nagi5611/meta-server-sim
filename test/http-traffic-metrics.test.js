// test/http-traffic-metrics.test.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    getHttpTrafficSnapshot,
    getPlatformBytesLastWindow,
    recordHttpTraffic,
    resetHttpTrafficMetricsForTests,
} from '../lib/http-traffic-metrics.js';

describe('http-traffic-metrics', () => {
    beforeEach(() => {
        resetHttpTrafficMetricsForTests();
    });

    it('records tenant traffic by category', () => {
        recordHttpTraffic('P-01', 'fds_smoke_main', 1000, { path: 'lite/smoke.bin' });
        recordHttpTraffic('P-01', 'fds_smoke_bulk', 2000, { path: 'lite/smoke.bin' });
        const snap = getHttpTrafficSnapshot({ id: 'P-01' });
        assert.equal(snap.bytesSentTotal, 3000);
        assert.equal(snap.byCategory.fds_smoke_main, 1000);
        assert.equal(snap.byCategory.fds_smoke_bulk, 2000);
        assert.equal(snap.topPaths.length, 2);
    });

    it('sums platform window bytes', () => {
        recordHttpTraffic('P-01', 'fds_smoke_main', 500);
        assert.equal(getPlatformBytesLastWindow(), 500);
        const platform = getHttpTrafficSnapshot();
        assert.equal(platform.bytesSentTotal, 500);
        assert.equal(platform.tenants['P-01'].bytesSentTotal, 500);
    });
});
