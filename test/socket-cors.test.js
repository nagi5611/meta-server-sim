// test/socket-cors.test.js — Socket.io CORS 既定（origin:true 禁止）
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { buildSocketIoCorsOptions } from '../lib/socket-cors.js';
import { getDefaultDevSocketCorsOrigins } from '../lib/platform-network-config.js';

describe('socket CORS', () => {
    /** @type {string | undefined} */
    let prevNodeEnv;

    beforeEach(() => {
        prevNodeEnv = process.env.NODE_ENV;
    });

    afterEach(() => {
        if (prevNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = prevNodeEnv;
        }
        delete process.env.VITE_DEV_PORT;
    });

    it('buildSocketIoCorsOptions uses explicit origins when set', () => {
        const cors = buildSocketIoCorsOptions({
            corsOrigins: ['https://sim.example.com'],
        });
        assert.deepEqual(cors, {
            origin: ['https://sim.example.com'],
            credentials: true,
        });
    });

    it('buildSocketIoCorsOptions denies cross-origin in production when unset', () => {
        process.env.NODE_ENV = 'production';
        const cors = buildSocketIoCorsOptions({ corsOrigins: [] });
        assert.deepEqual(cors, { origin: false, credentials: true });
    });

    it('buildSocketIoCorsOptions uses localhost dev defaults when unset', () => {
        delete process.env.NODE_ENV;
        const cors = buildSocketIoCorsOptions({});
        assert.deepEqual(cors.origin, getDefaultDevSocketCorsOrigins());
        assert.equal(cors.credentials, true);
        assert.notEqual(cors.origin, true);
    });

    it('getDefaultDevSocketCorsOrigins honors VITE_DEV_PORT', () => {
        process.env.VITE_DEV_PORT = '3100';
        const origins = getDefaultDevSocketCorsOrigins();
        assert.ok(origins.includes('http://localhost:3100'));
        assert.ok(origins.includes('http://127.0.0.1:3100'));
    });
});
