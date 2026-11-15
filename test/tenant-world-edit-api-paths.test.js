// test/tenant-world-edit-api-paths.test.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteTenantWorldEditApiUrl } from '../public/js/tenant-world-edit-api-paths.js';

function setLocation(pathname, host = 'localhost:3000', protocol = 'http:') {
    globalThis.window = {
        location: { protocol, host, pathname },
    };
}

describe('rewriteTenantWorldEditApiUrl', () => {
    beforeEach(() => {
        setLocation('/admin/tenant/P-01/world-edit');
    });

    it('rewrites /admin/worlds/patch on tenant world-edit page', () => {
        assert.equal(rewriteTenantWorldEditApiUrl('/admin/worlds/patch'), '/admin/tenants/P-01/worlds/patch');
        assert.equal(rewriteTenantWorldEditApiUrl('/admin/worlds'), '/admin/tenants/P-01/worlds');
    });

    it('fixes /admin/tenants/worlds/patch missing tenant id', () => {
        assert.equal(
            rewriteTenantWorldEditApiUrl('/admin/tenants/worlds/patch'),
            '/admin/tenants/P-01/worlds/patch'
        );
    });

    it('rewrites same-origin absolute admin URLs', () => {
        setLocation('/admin/tenant/P-01/world-edit', 'sim.example', 'https:');
        assert.equal(
            rewriteTenantWorldEditApiUrl('https://sim.example/admin/worlds/patch'),
            '/admin/tenants/P-01/worlds/patch'
        );
    });

    it('does not rewrite when not on world-edit', () => {
        setLocation('/admin/tenant/P-01');
        assert.equal(rewriteTenantWorldEditApiUrl('/admin/worlds'), '/admin/worlds');
    });
});
