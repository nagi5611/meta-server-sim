// test/client-ip.test.js
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    getClientIpFromRequest,
    getClientIpFromSocket,
    resetTrustForwardedClientIpCacheForTests,
} from '../lib/client-ip.js';

describe('client-ip', () => {
    afterEach(() => {
        resetTrustForwardedClientIpCacheForTests();
    });

    it('ignores X-Forwarded-For when trust proxy is off (default dev)', () => {
        const req = {
            ip: '9.9.9.9',
            headers: { 'x-forwarded-for': '9.9.9.9' },
            socket: { remoteAddress: '203.0.113.10' },
        };
        assert.equal(getClientIpFromRequest(req), '203.0.113.10');

        const socket = {
            handshake: {
                headers: { 'x-forwarded-for': '9.9.9.9' },
                address: '203.0.113.10',
            },
        };
        assert.equal(getClientIpFromSocket(socket), '203.0.113.10');
    });

    it('normalizes IPv4-mapped IPv6', () => {
        const req = {
            ip: '',
            headers: {},
            socket: { remoteAddress: '::ffff:127.0.0.1' },
        };
        assert.equal(getClientIpFromRequest(req), '127.0.0.1');
    });
});
