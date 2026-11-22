// test/chart-ranking-d1.test.js
import { describe, it, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import {
    getChartRankingFromStore,
    normalizeChartRankingPart,
    recordChartScoreInStore,
    resetChartScoresForTests,
    usesChartRankingD1,
} from '../lib/chart-ranking-store.js';

const ENV_KEYS = [
    'CHART_RANKING_D1_DATABASE_ID',
    'CHART_RANKING_D1_DATABASE_NAME',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_ACCOUNT_ID',
];

/** @type {Record<string, string | undefined>} */
const prev = {};

const fakeTenant = { id: 'meta-server' };

describe('chart-ranking D1 store', () => {
    beforeEach(() => {
        resetChartScoresForTests();
        for (const k of ENV_KEYS) {
            prev[k] = process.env[k];
            delete process.env[k];
        }
    });

    afterEach(() => {
        resetChartScoresForTests();
        for (const k of ENV_KEYS) {
            if (prev[k] === undefined) delete process.env[k];
            else process.env[k] = prev[k];
        }
        mock.restoreAll();
    });

    it('normalizeChartRankingPart clamps invalid values to 0', () => {
        assert.equal(normalizeChartRankingPart(undefined), 0);
        assert.equal(normalizeChartRankingPart('2'), 2);
        assert.equal(normalizeChartRankingPart(99), 0);
    });

    it('uses memory when CHART_RANKING_D1_DATABASE_ID is unset', () => {
        assert.equal(usesChartRankingD1(), false);
    });

    it('memory path keeps ranking order', async () => {
        await recordChartScoreInStore(fakeTenant, 'c1', 'A', 100, 0);
        await recordChartScoreInStore(fakeTenant, 'c1', 'B', 200, 0);
        const top = await getChartRankingFromStore(fakeTenant, 'c1');
        assert.deepEqual(top, [
            { username: 'B', score: 200 },
            { username: 'A', score: 100 },
        ]);
    });

    it('D1 path calls Cloudflare API and returns rows', async () => {
        process.env.CHART_RANKING_D1_DATABASE_ID = '1fb44f99-303c-4175-8a5b-6048e638a448';
        process.env.CLOUDFLARE_API_TOKEN = 'test-token';
        process.env.CLOUDFLARE_ACCOUNT_ID = 'acct-1';
        assert.equal(usesChartRankingD1(), true);

        let call = 0;
        mock.method(globalThis, 'fetch', async (_url, init) => {
            call += 1;
            const body = JSON.parse(String(init?.body || '{}'));
            if (call === 1) {
                assert.match(body.sql, /INSERT INTO chart_ranking_scores/);
                return {
                    ok: true,
                    json: async () => ({
                        success: true,
                        result: [{ success: true, results: [], meta: { changes: 1 } }],
                    }),
                };
            }
            if (call === 2) {
                assert.match(body.sql, /DELETE FROM chart_ranking_scores/);
                return {
                    ok: true,
                    json: async () => ({
                        success: true,
                        result: [{ success: true, results: [], meta: { changes: 0 } }],
                    }),
                };
            }
            assert.match(body.sql, /SELECT username, score/);
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    result: [
                        {
                            success: true,
                            results: [{ username: 'Guest', score: 42 }],
                            meta: {},
                        },
                    ],
                }),
            };
        });

        await recordChartScoreInStore(fakeTenant, 'todoroki2026', 'Guest', 42, 0);
        const ranking = await getChartRankingFromStore(fakeTenant, 'todoroki2026');
        assert.deepEqual(ranking, [{ username: 'Guest', score: 42 }]);
        assert.equal(call, 3);
    });
});