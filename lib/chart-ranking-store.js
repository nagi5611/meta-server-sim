// lib/chart-ranking-store.js — 譜面スコアランキング（メモリ / D1）

import {
    isChartRankingD1Configured,
} from './d1/chart-ranking-d1-config.js';
import { chartRankingD1Query } from './d1/chart-ranking-d1-client.js';

const CHART_SCORE_MAX_ENTRIES = 100;
const CHART_RANKING_TOP = 10;

/** @type {Map<string, Record<string, Record<number, Array<{ username: string, score: number }>>>>} */
const chartScoresByTenantId = new Map();

/**
 * @param {string} tenantId
 * @returns {Record<string, Record<number, Array<{ username: string, score: number }>>>}
 */
function getTenantScoreMap(tenantId) {
    let map = chartScoresByTenantId.get(tenantId);
    if (!map) {
        map = {};
        chartScoresByTenantId.set(tenantId, map);
    }
    return map;
}

/**
 * @param {unknown} part
 * @returns {number}
 */
export function normalizeChartRankingPart(part) {
    if (part === undefined || part === null || part === '') return 0;
    const n = typeof part === 'number' ? part : Number.parseInt(String(part), 10);
    if (!Number.isFinite(n) || n < 0 || n > 3) return 0;
    return Math.trunc(n);
}

/**
 * @param {string} tenantId
 * @param {string} chartId
 * @param {number} part
 * @param {string} username
 * @param {number} scoreNum
 */
function recordChartScoreMemory(tenantId, chartId, part, username, scoreNum) {
    const scores = getTenantScoreMap(tenantId);
    const partKey = String(part);
    if (!scores[chartId]) scores[chartId] = {};
    if (!scores[chartId][part]) scores[chartId][part] = [];
    scores[chartId][part].push({ username, score: scoreNum });
    scores[chartId][part].sort((a, b) => b.score - a.score);
    if (scores[chartId][part].length > CHART_SCORE_MAX_ENTRIES) {
        scores[chartId][part] = scores[chartId][part].slice(0, CHART_SCORE_MAX_ENTRIES);
    }
}

/**
 * @param {string} tenantId
 * @param {string} chartId
 * @param {number} part
 * @param {number} [topN]
 * @returns {Array<{ username: string, score: number }>}
 */
function getChartRankingMemory(tenantId, chartId, part, topN = CHART_RANKING_TOP) {
    const scores = getTenantScoreMap(tenantId);
    const list = scores[chartId]?.[part] || [];
    return list.slice(0, Math.max(1, topN));
}

/**
 * @param {string} tenantId
 * @param {string} chartId
 * @param {number} part
 * @param {string} username
 * @param {number} scoreNum
 */
async function recordChartScoreD1(tenantId, chartId, part, username, scoreNum) {
    const createdAt = Date.now();
    await chartRankingD1Query(
        `INSERT INTO chart_ranking_scores (tenant_id, chart_id, part, username, score, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [tenantId, chartId, part, username, scoreNum, createdAt]
    );
    await chartRankingD1Query(
        `DELETE FROM chart_ranking_scores
         WHERE tenant_id = ? AND chart_id = ? AND part = ?
           AND id NOT IN (
             SELECT id FROM chart_ranking_scores
             WHERE tenant_id = ? AND chart_id = ? AND part = ?
             ORDER BY score DESC, id ASC
             LIMIT ?
           )`,
        [tenantId, chartId, part, tenantId, chartId, part, CHART_SCORE_MAX_ENTRIES]
    );
}

/**
 * @param {string} tenantId
 * @param {string} chartId
 * @param {number} part
 * @param {number} [topN]
 * @returns {Promise<Array<{ username: string, score: number }>>}
 */
async function getChartRankingD1(tenantId, chartId, part, topN = CHART_RANKING_TOP) {
    const limit = Math.max(1, topN);
    const { rows } = await chartRankingD1Query(
        `SELECT username, score FROM chart_ranking_scores
         WHERE tenant_id = ? AND chart_id = ? AND part = ?
         ORDER BY score DESC, id ASC
         LIMIT ?`,
        [tenantId, chartId, part, limit]
    );
    return rows.map((r) => ({
        username: String(r.username ?? ''),
        score: Number(r.score ?? 0),
    }));
}

/**
 * D1 設定時は D1 のみ（障害時は呼び出し元で 503）。未設定時はメモリ。
 * @returns {boolean}
 */
export function usesChartRankingD1() {
    return isChartRankingD1Configured();
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {string} chartId
 * @param {string} username
 * @param {number} scoreNum
 * @param {number} [part]
 */
export async function recordChartScoreInStore(tenant, chartId, username, scoreNum, part = 0) {
    const p = normalizeChartRankingPart(part);
    if (usesChartRankingD1()) {
        await recordChartScoreD1(tenant.id, chartId, p, username, scoreNum);
        return;
    }
    recordChartScoreMemory(tenant.id, chartId, p, username, scoreNum);
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {string} chartId
 * @param {number} [topN]
 * @param {number} [part]
 */
export async function getChartRankingFromStore(tenant, chartId, topN = CHART_RANKING_TOP, part = 0) {
    const p = normalizeChartRankingPart(part);
    if (usesChartRankingD1()) {
        return getChartRankingD1(tenant.id, chartId, p, topN);
    }
    return getChartRankingMemory(tenant.id, chartId, p, topN);
}

/** 単体テスト用 */
export function resetChartScoresForTests() {
    chartScoresByTenantId.clear();
}