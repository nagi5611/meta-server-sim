import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
    isBootstrapAdminPublicSessionLinked,
    isSimLobbyAdminUser,
    resolveBootstrapAdminEligibility,
    resolveBootstrapAdminTtlSec,
} from '../src/lobby-admin-bootstrap-guard.js';

test('isSimLobbyAdminUser treats teachers as admin when lobbyRole omitted', () => {
    assert.equal(isSimLobbyAdminUser('teacher', {}), true);
    assert.equal(isSimLobbyAdminUser('student', {}), false);
    assert.equal(isSimLobbyAdminUser('student', { lobbyRole: 'admin' }), true);
});

test('resolveBootstrapAdminEligibility rejects demoted lobby admin from sim', async () => {
    const prev = globalThis.fetch;
    globalThis.fetch = async () =>
        new Response(JSON.stringify({ lobbyRole: 'user', banned: false }), { status: 200 });
    try {
        const result = await resolveBootstrapAdminEligibility(
            { sub: 'teacher-1', role: 'admin' },
            { LOBBY_SIM_ORIGIN: 'https://sim.test', LOBBY_SIM_SERVICE_TOKEN: 'tok' },
        );
        assert.equal(result.allowed, false);
        assert.equal(result.reason, 'demoted');
    } finally {
        globalThis.fetch = prev;
    }
});

test('resolveBootstrapAdminEligibility allows admin when sim confirms role', async () => {
    const prev = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify({ lobbyRole: 'admin' }), { status: 200 });
    try {
        const result = await resolveBootstrapAdminEligibility(
            { sub: 'student-3', role: 'admin' },
            { LOBBY_SIM_ORIGIN: 'https://sim.test', LOBBY_SIM_SERVICE_TOKEN: 'tok' },
        );
        assert.equal(result.allowed, true);
        assert.equal(result.reason, 'sim_verified');
    } finally {
        globalThis.fetch = prev;
    }
});

test('resolveBootstrapAdminEligibility falls back when sim is not configured', async () => {
    const result = await resolveBootstrapAdminEligibility({ sub: 'student-3', role: 'admin' }, {});
    assert.equal(result.allowed, true);
    assert.equal(result.fallback, true);
});

test('isBootstrapAdminPublicSessionLinked requires matching admin public session', () => {
    assert.equal(
        isBootstrapAdminPublicSessionLinked({ sub: 'teacher-1', role: 'admin' }, { lobbySub: 'teacher-1' }),
        true,
    );
    assert.equal(
        isBootstrapAdminPublicSessionLinked({ sub: 'teacher-1', role: 'member' }, { lobbySub: 'teacher-1' }),
        false,
    );
});

test('resolveBootstrapAdminTtlSec honors bounded env override', () => {
    assert.equal(resolveBootstrapAdminTtlSec({}), 7200);
    assert.equal(resolveBootstrapAdminTtlSec({ LOBBY_ADMIN_BOOTSTRAP_TTL_SECONDS: '999999' }), 7200);
    assert.equal(resolveBootstrapAdminTtlSec({ LOBBY_ADMIN_BOOTSTRAP_TTL_SECONDS: '3600' }), 3600);
});