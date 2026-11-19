// test/tenant-security-headers-http.test.js — CSP が HTTP ヘッダに載ること
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import http from 'node:http';

describe('tenant CSP middleware response header', () => {
    /** @type {string | undefined} */
    let savedNodeEnv;

    beforeEach(() => {
        savedNodeEnv = process.env.NODE_ENV;
    });

    afterEach(() => {
        if (savedNodeEnv === undefined) {
            delete process.env.NODE_ENV;
        } else {
            process.env.NODE_ENV = savedNodeEnv;
        }
    });

    /**
     * @param {string} url
     * @returns {Promise<import('node:http').IncomingMessage>}
     */
    function getHeaders(url) {
        return new Promise((resolve, reject) => {
            http.get(url, (res) => {
                res.resume();
                resolve(res);
            }).on('error', reject);
        });
    }

    it('production responses omit script-src unsafe-eval', async () => {
        process.env.NODE_ENV = 'production';
        const { tenantSecurityHeadersMiddleware, buildTenantContentSecurityPolicy } = await import(
            '../lib/tenant-security-headers.js'
        );
        const app = express();
        app.use(tenantSecurityHeadersMiddleware);
        app.get('/', (_req, res) => res.send('ok'));
        const server = await new Promise((resolve) => {
            const s = app.listen(0, '127.0.0.1', () => resolve(s));
        });
        const addr = server.address();
        assert.ok(addr && typeof addr === 'object');
        const res = await getHeaders(`http://127.0.0.1:${addr.port}/`);
        await new Promise((resolve) => server.close(resolve));
        const csp = String(res.headers['content-security-policy'] || '');
        assert.equal(csp, buildTenantContentSecurityPolicy());
        assert.doesNotMatch(csp, /'unsafe-eval'/);
        assert.match(csp, /wasm-unsafe-eval/);
    });
});