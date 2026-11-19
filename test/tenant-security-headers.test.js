// test/tenant-security-headers.test.js — CSP unsafe-eval / wasm-unsafe-eval
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

describe('tenant Content-Security-Policy', () => {
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

    it('production script-src has wasm-unsafe-eval but not unsafe-eval', async () => {
        process.env.NODE_ENV = 'production';
        const { buildTenantContentSecurityPolicy } = await import('../lib/tenant-security-headers.js');
        const csp = buildTenantContentSecurityPolicy();
        assert.match(csp, /wasm-unsafe-eval/);
        assert.doesNotMatch(csp, /'unsafe-eval'/);
        assert.match(csp, /'unsafe-inline'/);
    });

    it('development script-src includes unsafe-eval for Vite HMR', async () => {
        process.env.NODE_ENV = 'development';
        const { buildTenantContentSecurityPolicy } = await import('../lib/tenant-security-headers.js');
        const csp = buildTenantContentSecurityPolicy();
        assert.match(csp, /'unsafe-eval'/);
        assert.match(csp, /wasm-unsafe-eval/);
    });
});

describe('admin panel Content-Security-Policy', () => {
    it('script-src has wasm-unsafe-eval but not unsafe-eval', async () => {
        const { buildAdminPanelContentSecurityPolicy } = await import('../lib/admin-auth.js');
        const csp = buildAdminPanelContentSecurityPolicy();
        assert.match(csp, /wasm-unsafe-eval/);
        assert.doesNotMatch(csp, /'unsafe-eval'/);
        assert.match(csp, /cdn\.jsdelivr\.net/);
    });
});