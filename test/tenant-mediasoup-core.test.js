// test/tenant-mediasoup-core.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    buildVcRoomId,
    parseWorldIdFromVcRoom,
} from '../lib/tenant-mediasoup-core.js';

describe('tenant-mediasoup-core room ids', () => {
    it('buildVcRoomId prefixes tenant id', () => {
        assert.equal(buildVcRoomId('P-01', 'lobby'), 'P-01:lobby');
        assert.equal(buildVcRoomId('P-01', 'world-a'), 'P-01:world-a');
    });

    it('parseWorldIdFromVcRoom extracts world id for tenant', () => {
        assert.equal(parseWorldIdFromVcRoom('P-01:lobby', 'P-01'), 'lobby');
        assert.equal(parseWorldIdFromVcRoom('P-01:world-a', 'P-01'), 'world-a');
        assert.equal(parseWorldIdFromVcRoom('other:lobby', 'P-01'), null);
    });
});
