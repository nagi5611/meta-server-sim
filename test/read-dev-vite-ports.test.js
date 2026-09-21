// test/read-dev-vite-ports.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
    readAllDevPorts,
    readExtraVitePorts,
    resolveBaseViteDevPort,
    resolveFdsBulkDevPort,
    resolveNodeDevPort,
} from '../scripts/read-dev-vite-ports.mjs';

describe('read-dev-vite-ports', () => {
    /** @type {Record<string, string | undefined>} */
    const saved = {};

    beforeEach(() => {
        for (const key of ['PORT', 'VITE_DEV_PORT']) {
            saved[key] = process.env[key];
            delete process.env[key];
        }
    });

    afterEach(() => {
        for (const [key, value] of Object.entries(saved)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
        }
    });

    it('resolveNodeDevPort defaults to 3002', () => {
        assert.equal(resolveNodeDevPort(), 3002);
        process.env.PORT = '3999';
        assert.equal(resolveNodeDevPort(), 3999);
    });

    it('resolveFdsBulkDevPort avoids Vite port collision', () => {
        assert.equal(resolveFdsBulkDevPort(3002), 3012);
        process.env.VITE_DEV_PORT = '3010';
        assert.equal(resolveFdsBulkDevPort(3009), 3012);
        assert.equal(resolveFdsBulkDevPort(3008), 3009);
    });

    it('readAllDevPorts includes node, vite, bulk, and network-config extras', () => {
        const ports = readAllDevPorts();
        assert.ok(ports.includes(3002));
        assert.ok(ports.includes(3003));
        assert.ok(ports.includes(3012));
        const extras = readExtraVitePorts();
        for (const p of extras) {
            assert.ok(ports.includes(p));
        }
    });

    it('resolveBaseViteDevPort honors VITE_DEV_PORT', () => {
        process.env.VITE_DEV_PORT = '3100';
        assert.equal(resolveBaseViteDevPort(), 3100);
        const ports = readAllDevPorts();
        assert.ok(ports.includes(3100));
    });
});
