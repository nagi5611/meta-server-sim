// test/tenant-metaverse-http-auth.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    signSocketAuthToken,
    verifySocketAuthToken,
} from '../../metaverse-simple/lib/socket-auth-token.js';
import { generateAdminToken, peekAdminToken } from '../lib/admin-metaverse-token.js';
import {
    getSocketAuthTokenFromHttp,
    isAdminBasicAuthorized,
    isTenantMetaverseHttpAuthorized,
    readCookieFromHeader,
    TENANT_SOCKET_AUTH_COOKIE,
    TENANT_SOCKET_AUTH_QUERY,
} from '../lib/tenant-metaverse-http-auth.js';
import { resolveAdminCredentials } from '../lib/admin-auth.js';

/** @type {string | undefined} */
let prevSocketSecret;

beforeEach(() => {
    prevSocketSecret = process.env.SOCKET_AUTH_SECRET;
    process.env.SOCKET_AUTH_SECRET = 'unit-test-socket-auth-secret';
});

afterEach(() => {
    if (prevSocketSecret === undefined) {
        delete process.env.SOCKET_AUTH_SECRET;
    } else {
        process.env.SOCKET_AUTH_SECRET = prevSocketSecret;
    }
});

describe('tenant-metaverse-http-auth', () => {
    it('readCookieFromHeader parses named cookie', () => {
        const v = readCookieFromHeader('a=1; metaverse_socket_auth=abc.def; b=2', TENANT_SOCKET_AUTH_COOKIE);
        assert.equal(v, 'abc.def');
    });

    it('isTenantMetaverseHttpAuthorized accepts valid socket auth cookie', () => {
        const token = signSocketAuthToken({ role: 'guest' });
        assert.ok(verifySocketAuthToken(token));
        const req = {
            headers: { cookie: `${TENANT_SOCKET_AUTH_COOKIE}=${token}` },
            body: {},
        };
        assert.equal(isTenantMetaverseHttpAuthorized(req), true);
        assert.equal(getSocketAuthTokenFromHttp(req), token);
    });

    it('isTenantMetaverseHttpAuthorized rejects missing auth', () => {
        const req = { headers: {}, body: {} };
        assert.equal(isTenantMetaverseHttpAuthorized(req), false);
    });

    it('isTenantMetaverseHttpAuthorized accepts socket auth query param', () => {
        const token = signSocketAuthToken({ role: 'guest' });
        const req = {
            headers: {},
            query: { [TENANT_SOCKET_AUTH_QUERY]: token },
            body: {},
        };
        assert.equal(isTenantMetaverseHttpAuthorized(req), true);
        assert.equal(getSocketAuthTokenFromHttp(req), token);
    });

    it('isTenantMetaverseHttpAuthorized accepts peekAdminToken via cookie', () => {
        const { token } = generateAdminToken('default', '127.0.0.1');
        assert.ok(peekAdminToken(token, '127.0.0.1'));
        const req = {
            headers: {
                cookie: `metaverseAdminToken=${encodeURIComponent(token)}`,
            },
            body: {},
            socket: { remoteAddress: '127.0.0.1' },
        };
        assert.equal(isTenantMetaverseHttpAuthorized(req), true);
    });

    it('isAdminBasicAuthorized validates platform admin credentials', () => {
        const { username, password } = resolveAdminCredentials();
        const encoded = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
        const req = { headers: { authorization: `Basic ${encoded}` } };
        assert.equal(isAdminBasicAuthorized(req), true);
    });
});
