// lib/tenant-charts.js — テナント単位の譜面 JSON とランキング（メモリ）

import fs from 'node:fs';

const CHART_SCORE_USERNAME_MAX_LEN = 64;
const CHART_SCORE_MAX_ENTRIES = 100;
const CHART_RANKING_TOP = 10;

/** @type {Map<string, Record<string, Array<{ username: string, score: number }>>>} */
const chartScoresByTenantId = new Map();

/**
 * プラットフォーム env で譜面を総禁止するか
 * @returns {boolean} true なら全テナントで無効
 */
function isPlatformChartFeaturesHardDisabled() {
    const s = String(process.env.ENABLE_CHART_FEATURES ?? '').trim().toLowerCase();
    return ['0', 'false', 'off', 'no'].includes(s);
}

/**
 * テナントで太鼓・譜面 API を有効にするか
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @returns {boolean}
 */
export function isChartFeaturesEnabled(tenant) {
    if (isPlatformChartFeaturesHardDisabled()) return false;
    if (tenant.chartFeaturesEnabled === true) return true;
    const s = String(process.env.ENABLE_CHART_FEATURES ?? '').trim().toLowerCase();
    if (['1', 'true', 'on', 'yes'].includes(s)) return true;
    return false;
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 */
export function ensureChartsFile(tenant) {
    const chartsPath = tenant.paths.CHARTS_PATH;
    if (!fs.existsSync(chartsPath)) {
        fs.writeFileSync(chartsPath, '{}\n', 'utf8');
    }
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @returns {Record<string, unknown>}
 */
export function readCharts(tenant) {
    ensureChartsFile(tenant);
    try {
        const raw = fs.readFileSync(tenant.paths.CHARTS_PATH, 'utf8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object' && !Array.isArray(data)) return data;
        return {};
    } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[tenant:${tenant.id}] read charts.json failed:`, msg);
        return {};
    }
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {Record<string, unknown>} charts
 */
export function writeCharts(tenant, charts) {
    const chartsPath = tenant.paths.CHARTS_PATH;
    const tmpPath = `${chartsPath}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpPath, JSON.stringify(charts, null, 2), 'utf8');
    fs.renameSync(tmpPath, chartsPath);
}

/**
 * @param {string} tenantId
 * @returns {Record<string, Array<{ username: string, score: number }>>}
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
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {string} chartId
 * @param {string} username
 * @param {number} scoreNum
 */
export function recordChartScore(tenant, chartId, username, scoreNum) {
    const scores = getTenantScoreMap(tenant.id);
    if (!scores[chartId]) scores[chartId] = [];
    scores[chartId].push({ username, score: scoreNum });
    scores[chartId].sort((a, b) => b.score - a.score);
    if (scores[chartId].length > CHART_SCORE_MAX_ENTRIES) {
        scores[chartId] = scores[chartId].slice(0, CHART_SCORE_MAX_ENTRIES);
    }
}

/**
 * @param {import('./tenant-registry.js').TenantRecord} tenant
 * @param {string} chartId
 * @param {number} [topN]
 */
export function getChartRanking(tenant, chartId, topN = CHART_RANKING_TOP) {
    const scores = getTenantScoreMap(tenant.id);
    const list = scores[chartId] || [];
    return list.slice(0, Math.max(1, topN));
}

/**
 * @param {unknown} score
 * @returns {{ ok: true, value: number } | { ok: false, error: string }}
 */
export function parseChartScoreValue(score) {
    const scoreNum = typeof score === 'number' ? score : parseInt(String(score ?? ''), 10);
    if (Number.isNaN(scoreNum) || scoreNum < 0) {
        return { ok: false, error: 'Invalid score' };
    }
    return { ok: true, value: scoreNum };
}

/**
 * @param {unknown} username
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function parseChartScoreUsername(username) {
    const name = typeof username === 'string' && username.trim() ? username.trim() : 'プレイヤー';
    if (name.length > CHART_SCORE_USERNAME_MAX_LEN) {
        return { ok: false, error: 'username too long' };
    }
    return { ok: true, value: name };
}

/**
 * @param {Record<string, unknown>} charts
 * @param {string} chartId
 * @returns {boolean}
 */
export function chartExists(charts, chartId) {
    return Boolean(charts && typeof charts === 'object' && Object.prototype.hasOwnProperty.call(charts, chartId));
}

/** 単体テスト用 */
export function resetChartScoresForTests() {
    chartScoresByTenantId.clear();
}