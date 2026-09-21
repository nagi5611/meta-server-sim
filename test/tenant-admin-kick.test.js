// test/tenant-admin-kick.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    ADMIN_KICK_MESSAGE,
    ADMIN_KICK_RATE_LIMIT_MAX,
    applyAdminKickToSocket,
    buildAdminKickRejectionPayload,
    checkAndRecordAdminKickRateLimit,
    getAdminKickErrorMessage,
    replyAdminKickPlayer,
    resetAdminKickRateLimitForTests,
    resolveAdminKickPlayerRequest,
    validateAdminKickRequest,
} from '../lib/tenant-admin-kick.js';

describe('tenant-admin-kick', () => {
    const prevDisable = process.env.HTTP_RATE_LIMIT_DISABLE;

    beforeEach(() => {
        delete process.env.HTTP_RATE_LIMIT_DISABLE;
        resetAdminKickRateLimitForTests();
    });

    afterEach(() => {
        if (prevDisable === undefined) delete process.env.HTTP_RATE_LIMIT_DISABLE;
        else process.env.HTTP_RATE_LIMIT_DISABLE = prevDisable;
        resetAdminKickRateLimitForTests();
    });

    it('validateAdminKickRequest rejects non-admin', () => {
        assert.equal(
            validateAdminKickRequest({ data: { isAdmin: false } }, 'target', { connected: true }, 'P-01'),
            'forbidden',
        );
    });

    it('validateAdminKickRequest rejects self and cross-tenant', () => {
        const admin = { id: 'admin1', data: { isAdmin: true } };
        assert.equal(validateAdminKickRequest(admin, 'admin1', admin, 'P-01'), 'invalid_target');
        assert.equal(
            validateAdminKickRequest(admin, 'guest1', { connected: true, data: { tenantId: 'P-02' } }, 'P-01'),
            'not_found',
        );
    });

    it('validateAdminKickRequest rejects kicking admin target', () => {
        const admin = { id: 'admin1', data: { isAdmin: true } };
        const otherAdmin = { connected: true, data: { tenantId: 'P-01', isAdmin: true } };
        assert.equal(validateAdminKickRequest(admin, 'admin2', otherAdmin, 'P-01'), 'cannot_kick_admin');
    });

    it('validateAdminKickRequest accepts guest in same tenant', () => {
        const admin = { id: 'admin1', data: { isAdmin: true } };
        const guest = { connected: true, data: { tenantId: 'P-01', isAdmin: false } };
        assert.equal(validateAdminKickRequest(admin, 'guest1', guest, 'P-01'), null);
    });

    it('checkAndRecordAdminKickRateLimit blocks after max attempts', () => {
        const adminId = 'admin-rate-test';
        for (let i = 0; i < ADMIN_KICK_RATE_LIMIT_MAX; i += 1) {
            assert.equal(checkAndRecordAdminKickRateLimit(adminId), null);
        }
        assert.equal(checkAndRecordAdminKickRateLimit(adminId), 'rate_limited');
    });

    it('resolveAdminKickPlayerRequest returns rate_limited before validation', () => {
        const admin = { id: 'admin-busy', data: { isAdmin: true } };
        const guest = { connected: true, data: { tenantId: 'P-01', isAdmin: false } };
        for (let i = 0; i < ADMIN_KICK_RATE_LIMIT_MAX; i += 1) {
            assert.equal(resolveAdminKickPlayerRequest(admin, 'guest1', guest, 'P-01'), null);
        }
        assert.equal(resolveAdminKickPlayerRequest(admin, 'guest1', guest, 'P-01'), 'rate_limited');
    });

    it('buildAdminKickRejectionPayload includes localized message', () => {
        const payload = buildAdminKickRejectionPayload('not_found');
        assert.equal(payload.ok, false);
        assert.equal(payload.error, 'not_found');
        assert.equal(payload.message, getAdminKickErrorMessage('not_found'));
    });

    it('replyAdminKickPlayer invokes ack callback on rejection', () => {
        const events = [];
        const adminSocket = {
            emit(event, payload) {
                events.push({ event, payload });
            },
        };
        const payload = buildAdminKickRejectionPayload('cannot_kick_admin');
        let ackResult;
        replyAdminKickPlayer(adminSocket, payload, (res) => {
            ackResult = res;
        });
        assert.deepEqual(ackResult, payload);
        assert.equal(events.length, 0);
    });

    it('replyAdminKickPlayer emits admin-kick-rejected without callback', () => {
        const events = [];
        const adminSocket = {
            emit(event, payload) {
                events.push({ event, payload });
            },
        };
        const payload = buildAdminKickRejectionPayload('rate_limited');
        replyAdminKickPlayer(adminSocket, payload);
        assert.equal(events.length, 1);
        assert.equal(events[0].event, 'admin-kick-rejected');
        assert.deepEqual(events[0].payload, payload);
    });

    it('applyAdminKickToSocket emits admin-kicked then disconnects', () => {
        const events = [];
        let disconnected = false;
        const target = {
            emit(event, payload) {
                events.push({ event, payload });
            },
            disconnect() {
                disconnected = true;
            },
        };
        applyAdminKickToSocket(target, ADMIN_KICK_MESSAGE);
        assert.equal(events.length, 1);
        assert.equal(events[0].event, 'admin-kicked');
        assert.equal(events[0].payload.message, ADMIN_KICK_MESSAGE);
        assert.equal(disconnected, false);
        return new Promise((resolve) => {
            setTimeout(() => {
                assert.equal(disconnected, true);
                resolve();
            }, 150);
        });
    });
});
