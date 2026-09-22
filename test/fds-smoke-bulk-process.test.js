// test/fds-smoke-bulk-process.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    ensureSharedSocketAuthSecretBeforeFork,
    resolveFdsSmokeBulkPort,
    resolveFdsSmokeBulkPublicOrigin,
} from '../lib/fds-smoke-bulk-process.js';

describe('fds-smoke-bulk-process', () => {
    const envSnapshot = { ...process.env };

    beforeEach(() => {
        delete process.env.FDS_SMOKE_BULK_PORT;
        delete process.env.FDS_SMOKE_BULK_DISABLE;
        delete process.env.FDS_SMOKE_BULK_PUBLIC_ORIGIN;
        process.env.NODE_ENV = 'test';
        process.env.VITE_DEV_PORT = '3003';
    });

    afterEach(() => {
        process.env = { ...envSnapshot };
    });

    it('resolveFdsSmokeBulkPort avoids Vite dev port when PORT+1 would be 3003', () => {
        assert.equal(resolveFdsSmokeBulkPort(3002), 3012);
    });

    it('resolveFdsSmokeBulkPort honors explicit FDS_SMOKE_BULK_PORT', () => {
        process.env.FDS_SMOKE_BULK_PORT = '3999';
        assert.equal(resolveFdsSmokeBulkPort(3002), 3999);
    });

    it('ensureSharedSocketAuthSecretBeforeFork sets env when missing', () => {
        delete process.env.SOCKET_AUTH_SECRET;
        ensureSharedSocketAuthSecretBeforeFork();
        assert.ok(String(process.env.SOCKET_AUTH_SECRET || '').length >= 32);
        const before = process.env.SOCKET_AUTH_SECRET;
        ensureSharedSocketAuthSecretBeforeFork();
        assert.equal(process.env.SOCKET_AUTH_SECRET, before);
    });

    it('resolveFdsSmokeBulkPublicOrigin uses Vite front host in dev', () => {
        const req = {
            get(name) {
                if (name === 'x-forwarded-proto') return 'https';
                if (name === 'x-forwarded-host') return 'localhost:3003';
                return undefined;
            },
            secure: false,
        };
        assert.equal(resolveFdsSmokeBulkPublicOrigin(req, 3012), 'https://localhost:3003');
    });
});
