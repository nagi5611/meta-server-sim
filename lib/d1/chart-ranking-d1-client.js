// lib/d1/chart-ranking-d1-client.js — 譜面ランキング D1 専用 HTTP クエリ

import {
    getChartRankingD1DatabaseId,
    isChartRankingD1Configured,
} from './chart-ranking-d1-config.js';
import { getCloudflareAccountId, getCloudflareApiToken } from './d1-config.js';

const API_BASE = 'https://api.cloudflare.com/client/v4';

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<{ rows: Record<string, unknown>[], meta: Record<string, unknown> }>}
 */
export async function chartRankingD1Query(sql, params = []) {
    if (!isChartRankingD1Configured()) {
        throw new Error('Chart ranking D1 is not configured');
    }
    const accountId = getCloudflareAccountId();
    const databaseId = getChartRankingD1DatabaseId();
    const token = getCloudflareApiToken();
    const url = `${API_BASE}/accounts/${accountId}/d1/database/${databaseId}/query`;

    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql, params }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) {
        const msg =
            body.errors?.map((e) => e.message || e.code).join('; ') ||
            body.error ||
            res.statusText;
        throw new Error(`Chart ranking D1 query failed: ${msg}`);
    }
    const chunk = body.result?.[0];
    if (!chunk?.success) {
        throw new Error(String(chunk?.error || 'Chart ranking D1 query unsuccessful'));
    }
    return {
        rows: /** @type {Record<string, unknown>[]} */ (chunk.results ?? []),
        meta: chunk.meta ?? {},
    };
}