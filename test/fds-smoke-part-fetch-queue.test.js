// test/fds-smoke-part-fetch-queue.test.js
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
    enqueueFdsSmokePartFetch,
    resetFdsSmokePartFetchQueueForTests,
} from '../public/js/fds/fds-smoke-part-fetch-queue.js';

describe('fds-smoke-part-fetch-queue', () => {
    it('runs jobs with concurrency 1 in priority order', async () => {
        resetFdsSmokePartFetchQueueForTests();
        const order = [];
        const pLow = enqueueFdsSmokePartFetch('a', 'low', async () => {
            order.push('a');
            return 1;
        });
        const pHigh = enqueueFdsSmokePartFetch('b', 'high', async () => {
            order.push('b');
            return 2;
        });
        const [a, b] = await Promise.all([pLow, pHigh]);
        assert.equal(a, 1);
        assert.equal(b, 2);
        assert.deepEqual(order, ['b', 'a']);
    });

    it('deduplicates same key while in flight', async () => {
        resetFdsSmokePartFetchQueueForTests();
        let runs = 0;
        const run = () =>
            new Promise((resolve) => {
                runs += 1;
                setTimeout(() => resolve(42), 5);
            });
        const p1 = enqueueFdsSmokePartFetch('same', 'low', run);
        const p2 = enqueueFdsSmokePartFetch('same', 'high', run);
        assert.equal(await p1, 42);
        assert.equal(await p2, 42);
        assert.equal(runs, 1);
    });
});