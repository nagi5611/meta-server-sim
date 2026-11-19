// test/tenant-socket-auth.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { generateAdminToken, peekAdminToken } from '../lib/admin-metaverse-token.js';
import {
    getEffectiveTenantSocketSecret,
    getSocketJoinTokenFromHandshake,
    isTenantSocketJoinAuthorized,
    isTenantSocketJoinEnforced,
} from '../lib/tenant-socket-auth.js';
import { mintTenantSocketJoinToken } from '../lib/tenant-socket-join-token.js';

/** @type {string | undefined} */
let prevEnvSecret;
/** @type {string | undefined} */
let prevEnforce;

beforeEach(() => {
    prevEnvSecret = process.env.TENANT_SOCKET_SECRET;
    prevEnforce = process.env.TENANT_SOCKET_JOIN_ENFORCE;
    delete process.env.TENANT_SOCKET_SECRET;
    delete process.env.TENANT_SOCKET_JOIN_ENFORCE;
});

afterEach(() => {
    if (prevEnvSecret === undefined) {
        delete process.env.TENANT_SOCKET_SECRET;
    } else {
        process.env.TENANT_SOCKET_SECRET = prevEnvSecret;
    }
    if (prevEnforce === undefined) {
        delete process.env.TENANT_SOCKET_JOIN_ENFORCE;
    } else {
        process.env.TENANT_SOCKET_JOIN_ENFORCE = prevEnforce;
    }
});

const tenantBase = {
    id: 'P-01',
    displayName: 'P-01',
    enabled: true,
    rootPath: '/tmp',
    paths: {},
};

describe('tenant-socket-auth', () => {
    it('no secret configured allows any handshake', () => {
        assert.equal(getEffectiveTenantSocketSecret(tenantBase), '');
        assert.equal(
            isTenantSocketJoinAuthorized(tenantBase, { auth: {} }, '127.0.0.1'),
            true
        );
    });

    it('tenant socketSecret overrides env', () => {
        process.env.TENANT_SOCKET_SECRET = 'env-secret';
        const tenant = { ...tenantBase, socketSecret: 'tenant-secret' };
        assert.equal(getEffectiveTenantSocketSecret(tenant), 'tenant-secret');
        assert.equal(
            isTenantSocketJoinAuthorized(
                tenant,
                { auth: { joinToken: 'tenant-secret' } },
                '127.0.0.1'
            ),
            true
        );
        assert.equal(
            isTenantSocketJoinAuthorized(
                tenant,
                { auth: { joinToken: 'env-secret' } },
                '127.0.0.1'
            ),
            false
        );
    });

    it('requires matching joinToken when TENANT_SOCKET_SECRET set', () => {
        process.env.TENANT_SOCKET_SECRET = 'room-key';
        assert.equal(
            isTenantSocketJoinAuthorized(
                tenantBase,
                { auth: { joinToken: 'room-key' } },
                '127.0.0.1'
            ),
            true
        );
        assert.equal(
            isTenantSocketJoinAuthorized(tenantBase, { auth: {} }, '127.0.0.1'),
            false
        );
    });

    it('accepts socketSecret auth field alias', () => {
        process.env.TENANT_SOCKET_SECRET = 'room-key';
        const handshake = { auth: { socketSecret: 'room-key' } };
        assert.equal(getSocketJoinTokenFromHandshake(handshake), 'room-key');
        assert.equal(isTenantSocketJoinAuthorized(tenantBase, handshake, ''), true);
    });

    it('allows valid adminToken without join secret', () => {
        process.env.TENANT_SOCKET_SECRET = 'room-key';
        const { token } = generateAdminToken('default', '10.0.0.5');
        assert.equal(peekAdminToken(token, '10.0.0.5'), true);
        assert.equal(
            isTenantSocketJoinAuthorized(
                tenantBase,
                { auth: { adminToken: token } },
                '10.0.0.5'
            ),
            true
        );
    });

    it('allows valid admin metaverse HttpOnly cookie without auth.adminToken', () => {
        process.env.TENANT_SOCKET_SECRET = 'room-key';
        const { token } = generateAdminToken('default', '10.0.0.6');
        const handshake = {
            auth: {},
            headers: {
                cookie: `metaverseAdminToken=${encodeURIComponent(token)}`,
            },
        };
        assert.equal(isTenantSocketJoinAuthorized(tenantBase, handshake, '10.0.0.6'), true);
    });

    it('TENANT_SOCKET_JOIN_ENFORCE=0 keeps connections open with secret set', () => {
        process.env.TENANT_SOCKET_SECRET = 'room-key';
        process.env.TENANT_SOCKET_JOIN_ENFORCE = '0';
        assert.equal(isTenantSocketJoinEnforced(tenantBase), false);
        assert.equal(isTenantSocketJoinAuthorized(tenantBase, { auth: {} }, '127.0.0.1'), true);
    });

    it('accepts lobby-minted short-lived join token', () => {
        process.env.TENANT_SOCKET_SECRET = 'room-key';
        const minted = mintTenantSocketJoinToken(tenantBase);
        assert.ok(minted?.joinToken);
        assert.equal(
            isTenantSocketJoinAuthorized(
                tenantBase,
                { auth: { joinToken: minted.joinToken } },
                '127.0.0.1'
            ),
            true
        );
    });
});
