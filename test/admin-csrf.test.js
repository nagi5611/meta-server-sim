// test/admin-csrf.test.js — 管理 CSRF（短 TTL・セッション結合・double-submit）
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
    ADMIN_CSRF_COOKIE,
    ADMIN_CSRF_HEADER,
    ADMIN_CSRF_SESSION_COOKIE,
    createAdminCsrfBundle,
    readAdminCsrfCookieFromHeader,
} from '../lib/admin-csrf.js';

describe('admin CSRF', () => {
    const password = 'test-admin-password-16chars';
    const sessionId = 'session-abc123';

    it('issueToken verifies with matching session id', () => {
        const bundle = createAdminCsrfBundle(password);
        const { token, expiresAt } = bundle.issueToken(sessionId);
        assert.ok(token);
        assert.ok(expiresAt > Date.now());
        assert.equal(bundle.verifyToken(token, sessionId), true);
    });

    it('verifyToken rejects wrong session id', () => {
        const bundle = createAdminCsrfBundle(password);
        const { token } = bundle.issueToken(sessionId);
        assert.equal(bundle.verifyToken(token, 'other-session'), false);
    });

    it('verifyToken rejects expired tokens', () => {
        let now = Date.now() - 20 * 60 * 1000;
        const bundle = createAdminCsrfBundle(password, { nowMs: () => now });
        const { token } = bundle.issueToken(sessionId);
        now = Date.now();
        const verifyBundle = createAdminCsrfBundle(password, { nowMs: () => now });
        assert.equal(verifyBundle.verifyToken(token, sessionId), false);
    });

    it('adminCsrfProtection requires header and cookie to match', () => {
        const bundle = createAdminCsrfBundle(password);
        const { token } = bundle.issueToken(sessionId);
        const cookieHeader = `${ADMIN_CSRF_SESSION_COOKIE}=${encodeURIComponent(sessionId)}; ${ADMIN_CSRF_COOKIE}=${encodeURIComponent(token)}`;

        /** @type {import('express').Request} */
        const req = {
            method: 'POST',
            headers: {
                [ADMIN_CSRF_HEADER.toLowerCase()]: token,
                cookie: cookieHeader,
            },
        };
        let nextCalled = false;
        bundle.adminCsrfProtection(req, { status: () => ({ json: () => {} }) }, () => {
            nextCalled = true;
        });
        assert.equal(nextCalled, true);
    });

    it('adminCsrfProtection rejects missing double-submit cookie', () => {
        const bundle = createAdminCsrfBundle(password);
        const { token } = bundle.issueToken(sessionId);
        const cookieHeader = `${ADMIN_CSRF_SESSION_COOKIE}=${encodeURIComponent(sessionId)}`;

        /** @type {import('express').Request} */
        const req = {
            method: 'POST',
            headers: {
                [ADMIN_CSRF_HEADER.toLowerCase()]: token,
                cookie: cookieHeader,
            },
        };
        let statusCode = 0;
        bundle.adminCsrfProtection(
            req,
            {
                status(code) {
                    statusCode = code;
                    return { json: () => {} };
                },
            },
            () => {}
        );
        assert.equal(statusCode, 403);
    });

    it('registerAdminCsrfRoute sets session and CSRF cookies', async () => {
        const bundle = createAdminCsrfBundle(password);
        const setCookies = [];
        /** @type {import('express').Response} */
        const res = {
            append(name, value) {
                if (name === 'Set-Cookie') setCookies.push(value);
            },
            json() {},
        };
        /** @type {import('express').Request} */
        const req = { headers: {} };
        const app = {
            get(path, handler) {
                assert.equal(path, '/admin/csrf-token');
                handler(req, res);
            },
        };
        bundle.registerAdminCsrfRoute(app);
        assert.ok(setCookies.length >= 2);
        const cookieHeader = setCookies.join('; ');
        const csrfCookie = readAdminCsrfCookieFromHeader(cookieHeader);
        assert.ok(csrfCookie);
        const sid = cookieHeader.match(/adminCsrfSid=([^;]+)/)?.[1];
        assert.ok(sid);
        const decodedSid = decodeURIComponent(sid);
        assert.equal(bundle.verifyToken(csrfCookie, decodedSid), true);
    });

    it('rejects tampered signature', () => {
        const bundle = createAdminCsrfBundle(password);
        const { token } = bundle.issueToken(sessionId);
        const parts = token.split('.');
        const tampered = `${parts[0]}.${parts[1]}.${crypto.randomBytes(32).toString('hex')}`;
        assert.equal(bundle.verifyToken(tampered, sessionId), false);
    });
});
