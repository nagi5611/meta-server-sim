// public/js/fds/fds-smoke-part-fetch-queue.js — マルチパート .bin 取得の優先度キュー（同時 1）

import { getMaxConcurrentPartFetches } from './fds-smoke-transfer-defaults.js';

/** @typedef {'high' | 'medium' | 'low'} FdsPartFetchPriority */

const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

/** @type {Array<{ key: string, priority: FdsPartFetchPriority, run: () => Promise<unknown>, resolve: (v: unknown) => void, reject: (e: unknown) => void }>} */
let waiting = [];
let inFlight = 0;
/** @type {Map<string, Promise<unknown>>} */
const inflightByKey = new Map();

/**
 * @param {FdsPartFetchPriority} priority
 * @returns {number}
 */
function rank(priority) {
    return PRIORITY_RANK[priority] ?? PRIORITY_RANK.medium;
}

let pumpScheduled = false;

function pumpNow() {
    const max = getMaxConcurrentPartFetches();
    while (inFlight < max && waiting.length > 0) {
        waiting.sort((a, b) => rank(a.priority) - rank(b.priority));
        const job = waiting.shift();
        if (!job) break;
        inFlight += 1;
        const runPromise = job.run();
        inflightByKey.set(job.key, runPromise);
        runPromise
            .then((value) => {
                job.resolve(value);
            })
            .catch((err) => {
                job.reject(err);
            })
            .finally(() => {
                inFlight = Math.max(0, inFlight - 1);
                inflightByKey.delete(job.key);
                schedulePump();
            });
    }
}

function schedulePump() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(() => {
        pumpScheduled = false;
        pumpNow();
    });
}

/**
 * @template T
 * @param {string} key
 * @param {FdsPartFetchPriority} priority
 * @param {() => Promise<T>} run
 * @returns {Promise<T>}
 */
export function enqueueFdsSmokePartFetch(key, priority, run) {
    const existing = inflightByKey.get(key);
    if (existing) {
        return /** @type {Promise<T>} */ (existing);
    }

    for (const w of waiting) {
        if (w.key === key) {
            if (rank(priority) < rank(w.priority)) {
                w.priority = priority;
            }
            return new Promise((resolve, reject) => {
                const wrapResolve = (v) => resolve(/** @type {T} */ (v));
                const priorResolve = w.resolve;
                const priorReject = w.reject;
                w.resolve = (v) => {
                    priorResolve(v);
                    wrapResolve(v);
                };
                w.reject = (e) => {
                    priorReject(e);
                    reject(e);
                };
            });
        }
    }

    return new Promise((resolve, reject) => {
        waiting.push({ key, priority, run, resolve, reject });
        schedulePump();
    });
}

/** テスト用 */
export function resetFdsSmokePartFetchQueueForTests() {
    waiting = [];
    inFlight = 0;
    inflightByKey.clear();
}