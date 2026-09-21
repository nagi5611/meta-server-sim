// test/admin-metaverse-token.test.js
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    ADMIN_METAVERSE_TOKEN_COOKIE,
    ADMIN_TOKEN_TTL_MS,
    adminTokenClientIpMatches,
    buildAdminMetaverseTokenSetCookie,
    consumeAdminToken,
    generateAdminToken,
    peekAdminToken,
    readAdminTokenFromCookieHeader,
} from '../lib/admin-metaverse-token.js';
import {
    getClientIpFromRequest,
    getClientIpFromSocket,
    resetTrustForwardedClientIpCacheForTests,
} from '../lib/client-ip.js';

describe('admin-metaverse-token', () => {
    afterEach(() => {
        resetTrustForwardedClientIpCacheForTests();
    });

    it('generateAdminToken and consumeAdminToken round-trip', () => {
        const { token } = generateAdminToken('default', '127.0.0.1');
        assert.ok(token.length > 20);
        const auth = consumeAdminToken(token, '127.0.0.1');
        assert.equal(auth?.mode, 'default');
        assert.equal(consumeAdminToken(token, '127.0.0.1'), null);
    });

    it('peekAdminToken does not consume', () => {
        const { token } = generateAdminToken('default', '10.0.0.1');
        assert.equal(peekAdminToken(token, '10.0.0.1'), true);
        assert.equal(peekAdminToken(token, '10.0.0.1'), true);
        assert.ok(consumeAdminToken(token, '10.0.0.1'));
    });

    it('rejects mismatched client IP', () => {
        const { token } = generateAdminToken('default', '1.2.3.4');
        assert.equal(consumeAdminToken(token, '9.9.9.9'), null);
    });

    it('rejects when bound IP was empty at issue', () => {
        const { token } = generateAdminToken('default', '');
        assert.equal(peekAdminToken(token, '127.0.0.1'), false);
        assert.equal(consumeAdminToken(token, '127.0.0.1'), null);
    });

    it('rejects when consumer IP is empty', () => {
        const { token } = generateAdminToken('default', '1.2.3.4');
        assert.equal(peekAdminToken(token, ''), false);
        assert.equal(consumeAdminToken(token, ''), null);
    });

    it('adminTokenClientIpMatches requires both IPs', () => {
        assert.equal(adminTokenClientIpMatches('1.2.3.4', '1.2.3.4'), true);
        assert.equal(adminTokenClientIpMatches('1.2.3.4', ''), false);
        assert.equal(adminTokenClientIpMatches('', '1.2.3.4'), false);
        assert.equal(adminTokenClientIpMatches('1.2.3.4', '9.9.9.9'), false);
    });

    it('getClientIpFromRequest ignores X-Forwarded-For without trust proxy', () => {
        const req = {
            ip: '9.9.9.9',
            headers: { 'x-forwarded-for': '203.0.113.99' },
            socket: { remoteAddress: '203.0.113.10' },
        };
        assert.equal(getClientIpFromRequest(req), '203.0.113.10');
    });

    it('getClientIpFromSocket ignores X-Forwarded-For without trust proxy', () => {
        const socket = {
            handshake: {
                headers: { 'x-forwarded-for': '203.0.113.99' },
                address: '203.0.113.10',
            },
        };
        assert.equal(getClientIpFromSocket(socket), '203.0.113.10');
    });

    it('ADMIN_TOKEN_TTL_MS is five minutes', () => {
        assert.equal(ADMIN_TOKEN_TTL_MS, 5 * 60 * 1000);
    });

    it('readAdminTokenFromCookieHeader parses HttpOnly cookie name', () => {
        const { token } = generateAdminToken('default', '127.0.0.1');
        const header = buildAdminMetaverseTokenSetCookie(token);
        assert.ok(header.includes(`${ADMIN_METAVERSE_TOKEN_COOKIE}=`));
        assert.ok(header.includes('HttpOnly'));
        assert.equal(readAdminTokenFromCookieHeader(header), token);
        assert.equal(
            readAdminTokenFromCookieHeader(`other=1; ${header}; foo=bar`),
            token
        );
    });
});
