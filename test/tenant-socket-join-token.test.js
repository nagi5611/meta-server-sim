// test/tenant-socket-join-token.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import {
    mintTenantSocketJoinToken,
    verifyTenantSocketJoinToken,
} from '../lib/tenant-socket-join-token.js';

/** @type {string | undefined} */
let prevEnvSecret;

beforeEach(() => {
    prevEnvSecret = process.env.TENANT_SOCKET_SECRET;
    delete process.env.TENANT_SOCKET_SECRET;
});

afterEach(() => {
    if (prevEnvSecret === undefined) {
        delete process.env.TENANT_SOCKET_SECRET;
    } else {
        process.env.TENANT_SOCKET_SECRET = prevEnvSecret;
    }
});

const tenant = { id: 'P-01', displayName: 'P-01', enabled: true, rootPath: '/tmp', paths: {} };

describe('tenant-socket-join-token', () => {
    it('returns null when no secret configured', () => {
        assert.equal(mintTenantSocketJoinToken(tenant), null);
    });

    it('mints and verifies tenant-scoped token', () => {
        process.env.TENANT_SOCKET_SECRET = 'join-hmac-key';
        const minted = mintTenantSocketJoinToken(tenant);
        assert.ok(minted?.joinToken);
        assert.ok(verifyTenantSocketJoinToken(minted.joinToken, tenant));
        assert.equal(verifyTenantSocketJoinToken(minted.joinToken, { ...tenant, id: 'P-02' }), false);
    });

    it('rejects expired token', () => {
        process.env.TENANT_SOCKET_SECRET = 'join-hmac-key';
        const minted = mintTenantSocketJoinToken(tenant);
        assert.ok(minted?.joinToken);
        const parts = minted.joinToken.split('.');
        const expired = `${parts[0]}.${parts[1]}.1.${parts[3]}`;
        assert.equal(verifyTenantSocketJoinToken(expired, tenant), false);
    });
});