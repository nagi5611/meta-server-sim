// test/tenant-username.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
    PLATFORM_ADMIN_DISPLAY_NAME,
    buildReservedTenantUsernameSet,
    parseAndValidateTenantUsername,
} from '../lib/tenant-username.js';

describe('tenant-username', () => {
    it('buildReservedTenantUsernameSet includes platform admin and configured name', () => {
        const reserved = buildReservedTenantUsernameSet('Operator');
        assert.equal(reserved.has('admin'), true);
        assert.equal(reserved.has('operator'), true);
        assert.equal(reserved.has('guest'), false);
    });

    it('parseAndValidateTenantUsername rejects empty or too long names', () => {
        assert.deepEqual(
            parseAndValidateTenantUsername({ username: '' }, { isAdmin: false, reservedLowercase: new Set(['admin']) }),
            { ok: false, code: 'invalid_length' },
        );
        assert.deepEqual(
            parseAndValidateTenantUsername({ username: 'a'.repeat(33) }, {
                isAdmin: false,
                reservedLowercase: new Set(['admin']),
            }),
            { ok: false, code: 'invalid_length' },
        );
    });

    it('parseAndValidateTenantUsername rejects reserved names for non-admin', () => {
        const reserved = buildReservedTenantUsernameSet('Operator');
        for (const attempt of ['admin', 'Admin', 'ADMIN', 'Operator', 'OPERATOR']) {
            const result = parseAndValidateTenantUsername(
                { username: attempt },
                { isAdmin: false, reservedLowercase: reserved },
            );
            assert.equal(result.ok, false);
            if (!result.ok) assert.equal(result.code, 'reserved_username');
        }
    });

    it('parseAndValidateTenantUsername allows normal names for guests', () => {
        const reserved = buildReservedTenantUsernameSet(PLATFORM_ADMIN_DISPLAY_NAME);
        const result = parseAndValidateTenantUsername(
            { username: 'Taro' },
            { isAdmin: false, reservedLowercase: reserved },
        );
        assert.deepEqual(result, { ok: true, name: 'Taro' });
    });

    it('parseAndValidateTenantUsername allows reserved names for admin sockets', () => {
        const reserved = buildReservedTenantUsernameSet('Operator');
        const result = parseAndValidateTenantUsername(
            { username: 'admin' },
            { isAdmin: true, reservedLowercase: reserved },
        );
        assert.deepEqual(result, { ok: true, name: 'admin' });
    });
});
