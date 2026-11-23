// test/admin-basic-auth-metaverse-entry.test.js
import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import {
    ADMIN_BASIC_AUTH_EXEMPT_PATHS,
    adminRequestPathname,
    createBasicAuthMiddleware,
    isAdminBasicAuthExemptPath,
    resolveAdminCredentials,
} from '../lib/admin-auth.js';
import {
    generateAdminToken,
    buildAdminMetaverseTokenSetCookie,
    isActiveAdminMetaverseCookie,
} from '../lib/admin-metaverse-token.js';
import { getClientIpFromRequest } from '../lib/client-ip.js';

/**
 * @param {import('express').Request} req
 * @param {string} expectUser
 * @param {string} expectPass
 */
function isTestAdminBasicAuthorized(req, expectUser, expectPass) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Basic ')) return false;
    const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    const user = sep >= 0 ? decoded.slice(0, sep) : decoded;
    const pass = sep >= 0 ? decoded.slice(sep + 1) : '';
    return user === expectUser && pass === expectPass;
}

test('ADMIN_BASIC_AUTH_EXEMPT_PATHS includes metaverse guest probe routes', () => {
    assert.ok(ADMIN_BASIC_AUTH_EXEMPT_PATHS.has('/admin/metaverse-entry-probe'));
    assert.ok(ADMIN_BASIC_AUTH_EXEMPT_PATHS.has('/admin/enter-metaverse'));
    assert.ok(ADMIN_BASIC_AUTH_EXEMPT_PATHS.has('/admin/clear-metaverse-token'));
});

test('isAdminBasicAuthExemptPath matches pathname without query', () => {
    const req = { originalUrl: '/admin/metaverse-entry-probe?x=1', url: '/admin/metaverse-entry-probe?x=1' };
    assert.equal(adminRequestPathname(req), '/admin/metaverse-entry-probe');
    assert.equal(isAdminBasicAuthExemptPath(req), true);
});

test('basicAuth on exempt path does not set WWW-Authenticate', async () => {
    const prevUser = process.env.ADMIN_USERNAME;
    const prevPass = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'test-admin-password-16';
    try {
        const { username, password } = resolveAdminCredentials();
        const basicAuth = createBasicAuthMiddleware(username, password);
        const app = express();
        app.use('/admin', basicAuth);
        app.get('/admin/metaverse-entry-probe', (_req, res) => res.json({ active: false }));
        const server = app.listen(0);
        await new Promise((r) => server.once('listening', r));
        const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
        const res = await fetch(`http://127.0.0.1:${port}/admin/metaverse-entry-probe`);
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('www-authenticate'), null);
        const body = await res.json();
        assert.equal(body.active, false);
        await new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    } finally {
        if (prevUser === undefined) delete process.env.ADMIN_USERNAME;
        else process.env.ADMIN_USERNAME = prevUser;
        if (prevPass === undefined) delete process.env.ADMIN_PASSWORD;
        else process.env.ADMIN_PASSWORD = prevPass;
    }
});

test('enter-metaverse rejects guest without WWW-Authenticate', async () => {
    const prevUser = process.env.ADMIN_USERNAME;
    const prevPass = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'test-admin-password-16';
    try {
        const { username, password } = resolveAdminCredentials();
        const basicAuth = createBasicAuthMiddleware(username, password);
        const app = express();
        app.use('/admin', basicAuth);
        app.get('/admin/enter-metaverse', (req, res) => {
            const clientIp = getClientIpFromRequest(req);
            const hasAdminCookie = isActiveAdminMetaverseCookie(req.headers.cookie, clientIp);
            if (!hasAdminCookie && !isTestAdminBasicAuthorized(req, username, password)) {
                return res.status(401).json({ error: 'admin_credentials_required' });
            }
            const issued = generateAdminToken('default', clientIp || '127.0.0.1');
            res.json({ token: issued.token });
        });
        const server = app.listen(0);
        await new Promise((r) => server.once('listening', r));
        const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
        const res = await fetch(`http://127.0.0.1:${port}/admin/enter-metaverse`);
        assert.equal(res.status, 401);
        assert.equal(res.headers.get('www-authenticate'), null);
        await new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    } finally {
        if (prevUser === undefined) delete process.env.ADMIN_USERNAME;
        else process.env.ADMIN_USERNAME = prevUser;
        if (prevPass === undefined) delete process.env.ADMIN_PASSWORD;
        else process.env.ADMIN_PASSWORD = prevPass;
    }
});

test('enter-metaverse accepts valid admin cookie without basic auth', async () => {
    const prevUser = process.env.ADMIN_USERNAME;
    const prevPass = process.env.ADMIN_PASSWORD;
    process.env.ADMIN_USERNAME = 'admin';
    process.env.ADMIN_PASSWORD = 'test-admin-password-16';
    try {
        const clientIp = '127.0.0.1';
        const { token } = generateAdminToken('default', clientIp);
        const cookie = buildAdminMetaverseTokenSetCookie(token, { secure: false });
        const cookieValue = cookie.split(';')[0];

        const { username, password } = resolveAdminCredentials();
        const basicAuth = createBasicAuthMiddleware(username, password);
        const app = express();
        app.use('/admin', basicAuth);
        app.get('/admin/enter-metaverse', (req, res) => {
            const ip = getClientIpFromRequest(req) || clientIp;
            const hasAdminCookie = isActiveAdminMetaverseCookie(req.headers.cookie, ip);
            if (!hasAdminCookie && !isTestAdminBasicAuthorized(req, username, password)) {
                return res.status(401).json({ error: 'admin_credentials_required' });
            }
            const issued = generateAdminToken('default', ip);
            res.json({ token: issued.token });
        });
        const server = app.listen(0);
        await new Promise((r) => server.once('listening', r));
        const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
        const res = await fetch(`http://127.0.0.1:${port}/admin/enter-metaverse`, {
            headers: { cookie: cookieValue },
        });
        assert.equal(res.status, 200);
        assert.equal(res.headers.get('www-authenticate'), null);
        const body = await res.json();
        assert.ok(body.token);
        await new Promise((resolve, reject) => {
            server.close((err) => (err ? reject(err) : resolve()));
        });
    } finally {
        if (prevUser === undefined) delete process.env.ADMIN_USERNAME;
        else process.env.ADMIN_USERNAME = prevUser;
        if (prevPass === undefined) delete process.env.ADMIN_PASSWORD;
        else process.env.ADMIN_PASSWORD = prevPass;
    }
});