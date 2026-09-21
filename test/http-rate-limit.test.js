// test/http-rate-limit.test.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    createFixedWindowCounter,
    resetSocketHandshakeRateLimitForTests,
    resolveClientIp,
    resolveSocketClientIp,
    tenantSocketHandshakeRateLimitMiddleware,
} from '../lib/http-rate-limit.js';

describe('http-rate-limit', () => {
    beforeEach(() => {
        resetSocketHandshakeRateLimitForTests();
    });

    it('resolveClientIp ignores spoofed req.ip when trust proxy is off', () => {
        const req = {
            ip: '203.0.113.10',
            headers: { 'x-forwarded-for': '203.0.113.99' },
            socket: { remoteAddress: '127.0.0.1' },
        };
        assert.equal(resolveClientIp(req), '127.0.0.1');
    });

    it('fixed window counter blocks after max', () => {
        const counter = createFixedWindowCounter({ windowMs: 60_000, max: 2 });
        assert.equal(counter.tryConsume('k'), true);
        assert.equal(counter.tryConsume('k'), true);
        assert.equal(counter.tryConsume('k'), false);
    });

    it('tenantSocketHandshakeRateLimitMiddleware rejects excess handshakes', () => {
        const mw = tenantSocketHandshakeRateLimitMiddleware('P-01');
        const socket = {
            handshake: {
                address: '198.51.100.7',
                headers: {},
            },
        };
        let err = null;
        mw(socket, (e) => {
            err = e ?? null;
        });
        assert.equal(err, null);
        for (let i = 0; i < 30; i += 1) {
            mw(socket, () => {});
        }
        err = undefined;
        mw(socket, (e) => {
            err = e ?? null;
        });
        assert.ok(err instanceof Error);
        assert.equal(err.message, 'handshake_rate_limited');
    });

    it('resolveSocketClientIp ignores x-forwarded-for when trust proxy is off', () => {
        const ip = resolveSocketClientIp({
            handshake: {
                address: '127.0.0.1',
                headers: { 'x-forwarded-for': '198.51.100.2, 10.0.0.1' },
            },
        });
        assert.equal(ip, '127.0.0.1');
    });
});
