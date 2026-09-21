// test/fds-smoke-delivery.test.js
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseByteRangeHeader, createFdsSmokeStaticHandler } from '../lib/fds-smoke-delivery.js';

describe('fds-smoke-delivery', () => {
    it('parseByteRangeHeader accepts full and partial ranges', () => {
        assert.deepEqual(parseByteRangeHeader('bytes=0-99', 1000), { start: 0, end: 99 });
        assert.deepEqual(parseByteRangeHeader('bytes=500-', 1000), { start: 500, end: 999 });
    });

    it('parseByteRangeHeader rejects invalid ranges', () => {
        assert.equal(parseByteRangeHeader('bytes=1000-10', 500), null);
        assert.equal(parseByteRangeHeader('invalid', 500), null);
        assert.equal(parseByteRangeHeader('bytes=600-', 500), null);
    });

    describe('createFdsSmokeStaticHandler access control', () => {
        /** @type {string | undefined} */
        let prevSocketSecret;
        /** @type {string} */
        let tmpRoot;
        /** @type {import('../lib/tenant-registry.js').TenantRecord} */
        let tenant;

        beforeEach(() => {
            prevSocketSecret = process.env.SOCKET_AUTH_SECRET;
            process.env.SOCKET_AUTH_SECRET = 'fds-delivery-test-secret';
            tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'fds-smoke-acl-'));
            const simDir = path.join(tmpRoot, 'simulations', 'demo');
            fs.mkdirSync(simDir, { recursive: true });
            fs.writeFileSync(path.join(simDir, 'part-001.uint8.bin'), Buffer.from([1, 2, 3]));
            tenant = {
                id: 'P-test',
                paths: {
                    TENANT_ROOT: tmpRoot,
                    SIMULATIONS_DIR: path.join(tmpRoot, 'simulations'),
                },
            };
        });

        afterEach(() => {
            if (prevSocketSecret === undefined) {
                delete process.env.SOCKET_AUTH_SECRET;
            } else {
                process.env.SOCKET_AUTH_SECRET = prevSocketSecret;
            }
            fs.rmSync(tmpRoot, { recursive: true, force: true });
        });

        /**
         * @param {import('express').RequestHandler} handler
         * @param {Partial<import('express').Request>} reqInit
         * @returns {Promise<{ status: number, body: string }>}
         */
        function invokeHandler(handler, reqInit) {
            return new Promise((resolve, reject) => {
                const req = {
                    method: 'GET',
                    path: reqInit.path ?? '/demo/part-001.uint8.bin',
                    headers: reqInit.headers ?? {},
                    query: reqInit.query ?? {},
                    body: reqInit.body ?? {},
                    socket: { remoteAddress: '127.0.0.1' },
                };
                const res = {
                    statusCode: 200,
                    headers: {},
                    status(code) {
                        this.statusCode = code;
                        return this;
                    },
                    setHeader(name, value) {
                        this.headers[name.toLowerCase()] = value;
                    },
                    write(_chunk, _enc, cb) {
                        if (typeof cb === 'function') cb();
                        return true;
                    },
                    json(payload) {
                        resolve({ status: this.statusCode, body: JSON.stringify(payload) });
                    },
                    end() {
                        resolve({ status: this.statusCode, body: '' });
                    },
                };
                handler(req, res, (err) => (err ? reject(err) : undefined));
            });
        }

        it('returns 401 without metaverse http auth', async () => {
            const handler = createFdsSmokeStaticHandler(tenant);
            const result = await invokeHandler(handler, {});
            assert.equal(result.status, 401);
            assert.match(result.body, /metaverse_access_required/);
        });
    });
});
