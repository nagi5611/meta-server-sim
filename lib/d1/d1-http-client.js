// lib/d1/d1-http-client.js — Cloudflare D1 REST API（Express / Node 向け）

import {
    getCloudflareAccountId,
    getCloudflareApiToken,
    getD1DatabaseId,
    isD1UsersConfigured,
} from './d1-config.js';

const API_BASE = 'https://api.cloudflare.com/client/v4';

/**
 * @typedef {{ sql: string, params?: unknown[] }} D1Statement
 */

/**
 * @param {D1Statement[]} statements
 * @returns {Promise<{ results: unknown[][], meta: Record<string, unknown>[] }>}
 */
export async function d1Batch(statements) {
    if (!isD1UsersConfigured()) {
        throw new Error('D1 is not configured (CLOUDFLARE_API_TOKEN, account id, D1_DATABASE_ID)');
    }
    const accountId = getCloudflareAccountId();
    const databaseId = getD1DatabaseId();
    const token = getCloudflareApiToken();
    const url = `${API_BASE}/accounts/${accountId}/d1/database/${databaseId}/query`;

    /** @type {unknown[][]} */
    const allResults = [];
    /** @type {Record<string, unknown>[]} */
    const allMeta = [];

    for (const stmt of statements) {
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                sql: stmt.sql,
                params: stmt.params ?? [],
            }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok || body.success === false) {
            const msg =
                body.errors?.map((e) => e.message || e.code).join('; ') ||
                body.error ||
                res.statusText;
            const err = new Error(`D1 query failed: ${msg}`);
            err.code = body.errors?.[0]?.code;
            throw err;
        }
        const chunk = body.result?.[0];
        if (!chunk?.success) {
            const msg = chunk?.error || 'D1 query unsuccessful';
            throw new Error(String(msg));
        }
        allResults.push(chunk.results ?? []);
        allMeta.push(chunk.meta ?? {});
    }

    return { results: allResults, meta: allMeta };
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<{ rows: Record<string, unknown>[], meta: Record<string, unknown> }>}
 */
export async function d1Query(sql, params = []) {
    const { results, meta } = await d1Batch([{ sql, params }]);
    return { rows: /** @type {Record<string, unknown>[]} */ (results[0] ?? []), meta: meta[0] ?? {} };
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<Record<string, unknown> | undefined>}
 */
export async function d1First(sql, params = []) {
    const { rows } = await d1Query(sql, params);
    return rows[0];
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<Record<string, unknown>[]>}
 */
export async function d1All(sql, params = []) {
    const { rows } = await d1Query(sql, params);
    return rows;
}

/**
 * @param {string} sql
 * @param {unknown[]} [params]
 * @returns {Promise<{ changes: number, lastInsertRowid: number }>}
 */
export async function d1Run(sql, params = []) {
    const { meta } = await d1Query(sql, params);
    return {
        changes: Number(meta.changes ?? 0),
        lastInsertRowid: Number(meta.last_row_id ?? 0),
    };
}
