// test/tenant-taiko-socket.test.js
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
    _resetTaikoMpRoomsForTests,
    registerTenantTaikoSocketHandlers,
} from '../lib/tenant-taiko-socket.js';

function makeTenant(enabled = true) {
    return {
        id: 'meta-server',
        chartFeaturesEnabled: enabled,
        paths: { TENANT_ROOT: '/tmp' },
    };
}

function makeSocket() {
    const socket = new EventEmitter();
    socket.id = 'sock-a';
    socket.data = { currentRoom: 'lobby' };
    socket.handshake = { auth: {} };
    const handlers = new Map();
    socket.on = (ev, fn) => {
        handlers.set(ev, fn);
        return socket;
    };
    socket.off = () => socket;
    socket.emit = () => true;
    socket.join = () => {};
    socket.leave = () => {};
    return { socket, handlers };
}

describe('tenant-taiko-socket', () => {
    beforeEach(() => {
        _resetTaikoMpRoomsForTests();
    });

    it('taiko-time-sync returns serverNow', () => {
        const io = { to: () => ({ emit: () => {} }) };
        const { socket, handlers } = makeSocket();
        registerTenantTaikoSocketHandlers(socket, io, makeTenant(true));
        let called = false;
        handlers.get('taiko-time-sync')({}, (res) => {
            called = true;
            assert.equal(typeof res.serverNow, 'number');
        });
        assert.equal(called, true);
    });

    it('skips handlers when chart features disabled', () => {
        const io = { to: () => ({ emit: () => {} }) };
        const { socket, handlers } = makeSocket();
        registerTenantTaikoSocketHandlers(socket, io, makeTenant(false));
        assert.equal(handlers.has('taiko-time-sync'), false);
    });
});