// test/tenant-service-worker-register-shim.test.js
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { notifyServiceWorkerInvalidate } from '../public/js/tenant-service-worker-register-shim.js';

describe('tenant-service-worker-register-shim', () => {
    it('notifyServiceWorkerInvalidate resolves without service worker', async () => {
        const start = Date.now();
        await notifyServiceWorkerInvalidate(['/models/test.glb']);
        assert.ok(Date.now() - start < 3000, 'should not hang waiting for service worker');
    });
});
