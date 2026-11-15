// test/tenant-worlds-patch-route.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolveTenantIdFromAdminWorldEditRequest } from '../lib/tenant-world-edit-request.js';

describe('resolveTenantIdFromAdminWorldEditRequest', () => {
    it('reads tenant id from Referer on world-edit', () => {
        const req = {
            get(name) {
                if (name === 'referer') {
                    return 'https://sim.example/admin/tenant/P-01/world-edit';
                }
                return '';
            },
        };
        assert.equal(resolveTenantIdFromAdminWorldEditRequest(req), 'P-01');
    });

    it('falls back to X-Tenant-Admin-Id header', () => {
        const req = {
            get(name) {
                if (name === 'x-tenant-admin-id') return 'demo-tenant';
                return '';
            },
        };
        assert.equal(resolveTenantIdFromAdminWorldEditRequest(req), 'demo-tenant');
    });
});
