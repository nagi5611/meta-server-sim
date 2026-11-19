import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import {
    __testResetAdminSecretWarnings,
    resolveAdminOtpSecret,
    resolveAdminSessionSecret,
} from '../src/admin-secrets.js';

const SESSION = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const JWT = 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210';
const OTP = 'aaaabbbbccccddddeeeeffffaaaabbbbccccddddeeeeffffaaaabbbbccccdddd';

afterEach(() => {
    __testResetAdminSecretWarnings();
});

test('resolveAdminSessionSecret: prefers LOBBY_ADMIN_SESSION_SECRET', () => {
    const secret = resolveAdminSessionSecret({
        LOBBY_ADMIN_SESSION_SECRET: SESSION,
        LOBBY_JWT_SECRET: JWT,
    });
    assert.equal(secret, SESSION);
});

test('resolveAdminSessionSecret: falls back to LOBBY_JWT_SECRET with warning', () => {
    const warnings = [];
    const orig = console.warn;
    console.warn = (...args) => warnings.push(args.join(' '));
    try {
        const secret = resolveAdminSessionSecret({ LOBBY_JWT_SECRET: JWT });
        assert.equal(secret, JWT);
        assert.ok(warnings.some((w) => w.includes('[ADMIN_SECRETS]') && w.includes('LOBBY_JWT_SECRET')));
    } finally {
        console.warn = orig;
    }
});

test('resolveAdminOtpSecret: prefers ADMIN_OTP_SECRET', () => {
    const secret = resolveAdminOtpSecret({
        ADMIN_OTP_SECRET: OTP,
        LOBBY_ADMIN_SESSION_SECRET: SESSION,
        LOBBY_JWT_SECRET: JWT,
    });
    assert.equal(secret, OTP);
});

test('resolveAdminOtpSecret: falls back to session secret then JWT', () => {
    assert.equal(resolveAdminOtpSecret({ LOBBY_ADMIN_SESSION_SECRET: SESSION }), SESSION);
    assert.equal(resolveAdminOtpSecret({ LOBBY_JWT_SECRET: JWT }), JWT);
});