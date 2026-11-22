#!/usr/bin/env node
// scripts/apply-d1-migration-file.mjs — D1 に SQL ファイルを適用（users DB または chart-ranking DB）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { getCloudflareAccountId, getCloudflareApiToken, getD1DatabaseId } from '../lib/d1/d1-config.js';
import {
    getChartRankingD1DatabaseId,
    isChartRankingD1Configured,
} from '../lib/d1/chart-ranking-d1-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });

const API_BASE = 'https://api.cloudflare.com/client/v4';

/**
 * @param {string} databaseId
 * @param {string} sql
 */
async function runSql(databaseId, sql) {
    const accountId = getCloudflareAccountId();
    const token = getCloudflareApiToken();
    const url = `${API_BASE}/accounts/${accountId}/d1/database/${databaseId}/query`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ sql }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) {
        const msg =
            body.errors?.map((e) => e.message || e.code).join('; ') ||
            body.error ||
            res.statusText;
        throw new Error(msg);
    }
    const chunk = body.result?.[0];
    if (!chunk?.success) {
        throw new Error(String(chunk?.error || 'D1 execute failed'));
    }
    return chunk;
}

/**
 * SQL ファイルをセミコロンで分割（簡易）
 * @param {string} raw
 * @returns {string[]}
 */
function splitStatements(raw) {
    return raw
        .split(';')
        .map((s) => s.replace(/^\s*--[^\n]*\n/gm, '\n').trim())
        .filter((s) => s.length > 0);
}

async function main() {
    const target = process.argv[2] || 'chart-ranking';
    const fileArg = process.argv[3];
    if (!fileArg) {
        console.error('Usage: node scripts/apply-d1-migration-file.mjs <users|chart-ranking> <sql-file>');
        process.exit(1);
    }
    const sqlPath = path.isAbsolute(fileArg) ? fileArg : path.join(projectRoot, fileArg);
    if (!fs.existsSync(sqlPath)) {
        console.error(`File not found: ${sqlPath}`);
        process.exit(1);
    }

    let databaseId;
    if (target === 'chart-ranking') {
        if (!isChartRankingD1Configured()) {
            console.error('CHART_RANKING_D1_DATABASE_ID and CLOUDFLARE API credentials required');
            process.exit(1);
        }
        databaseId = getChartRankingD1DatabaseId();
    } else if (target === 'users') {
        databaseId = getD1DatabaseId();
        if (!databaseId || !getCloudflareApiToken() || !getCloudflareAccountId()) {
            console.error('Users D1 not configured');
            process.exit(1);
        }
    } else {
        console.error('target must be users or chart-ranking');
        process.exit(1);
    }

    const raw = fs.readFileSync(sqlPath, 'utf8');
    const statements = splitStatements(raw);
    console.log(`[apply-d1] target=${target} databaseId=${databaseId} statements=${statements.length}`);
    for (const sql of statements) {
        const preview = sql.split('\n')[0].slice(0, 80);
        console.log(`  run: ${preview}…`);
        await runSql(databaseId, sql);
    }
    console.log('[apply-d1] done');
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});