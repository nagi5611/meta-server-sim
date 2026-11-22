// lib/d1/chart-ranking-d1-config.js — 譜面ランキング専用 D1（ユーザ D1 とは別 database_id）

import { getPlatformEnv } from '../platform-env-config.js';
import { getCloudflareAccountId, getCloudflareApiToken } from './d1-config.js';

/**
 * @returns {string}
 */
export function getChartRankingD1DatabaseId() {
    return getPlatformEnv('CHART_RANKING_D1_DATABASE_ID')?.trim() || '';
}

/**
 * @returns {string}
 */
export function getChartRankingD1DatabaseName() {
    return getPlatformEnv('CHART_RANKING_D1_DATABASE_NAME')?.trim() || 'metaverse-sim-staging';
}

/**
 * 譜面ランキングを D1 に永続化するか（未設定時はメモリのみ）
 * @returns {boolean}
 */
export function isChartRankingD1Configured() {
    return Boolean(
        getChartRankingD1DatabaseId() &&
            getCloudflareAccountId() &&
            getCloudflareApiToken()
    );
}