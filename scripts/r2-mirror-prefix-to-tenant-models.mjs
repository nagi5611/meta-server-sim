#!/usr/bin/env node
// scripts/r2-mirror-prefix-to-tenant-models.mjs — meta/models → テナント models ミラー（サーバーサイド CopyObject）

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { validateTenantIdForCreate } from '../lib/tenant-id.js';
import {
    META_MODELS_SOURCE_PREFIX,
    decideMirrorAction,
    mapMetaModelsKeyToTenantModelsKey,
} from '../lib/r2/r2-mirror-prefix.js';
import { copyObject, getObject, headObject, listObjects } from '../lib/r2/r2-s3-client.js';
import { resetS3Client } from '../lib/r2/r2-s3-client.js';
import { isR2Enabled } from '../lib/r2/storage-backend.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.local') });

/**
 * Cloud Agent 向け R2 認証のフォールバック（値はログに出さない）
 */
function applyCloudAgentR2EnvFallback() {
    const map = [
        ['R2_ACCESS_KEY_ID', process.env.CLOUDFLARE_ACCOUNT_API_ACCESS_KEY_ID, process.env.CLOUDFLARE_ACCOUNT_API_ACCESS_KEY_id],
        ['R2_SECRET_ACCESS_KEY', process.env.CLOUDFLARE_ACCOUNT_API_SECRET_ACCESS_KEY],
        ['R2_ACCOUNT_ID', process.env.CLOUDFLARE_ACCOUNT_API_ACCOUNT_ID],
        ['R2_BUCKET_NAME', process.env.CLOUDFLARE_USING_R2BUKKET?.trim()],
    ];
    for (const [target, ...sources] of map) {
        if (process.env[target]?.trim()) continue;
        const val = sources.find((s) => s?.trim());
        if (val) process.env[target] = val.trim();
    }
    if (!process.env.STORAGE_BACKEND?.trim()) {
        process.env.STORAGE_BACKEND = 'r2';
    }
    resetS3Client();
}

/**
 * CLI 引数を解析する
 * @param {string[]} argv
 */
function parseArgs(argv) {
    let dryRun = false;
    let limit = Infinity;
    for (const arg of argv) {
        if (arg === '--dry-run') dryRun = true;
        else if (arg.startsWith('--limit=')) limit = Number.parseInt(arg.slice('--limit='.length), 10);
        else if (arg === '--limit') continue;
    }
    const limitIdx = argv.indexOf('--limit');
    if (limitIdx >= 0 && argv[limitIdx + 1]) {
        const n = Number.parseInt(argv[limitIdx + 1], 10);
        if (Number.isFinite(n) && n > 0) limit = n;
    }
    return { dryRun, limit };
}

/**
 * s3-sync-manifest があれば要約を表示する
 */
async function printManifestProgress() {
    const manifestKey = `${META_MODELS_SOURCE_PREFIX}_meta/s3-sync-manifest.json`;
    const obj = await getObject(manifestKey);
    if (!obj?.body) {
        console.log(`[manifest] not found: ${manifestKey}`);
        return;
    }
    const chunks = [];
    for await (const chunk of obj.body) {
        chunks.push(chunk);
    }
    const text = Buffer.concat(chunks).toString('utf8');
    try {
        const data = JSON.parse(text);
        const keys = Object.keys(data);
        console.log(`[manifest] ${manifestKey} — top-level keys: ${keys.slice(0, 8).join(', ')}${keys.length > 8 ? '…' : ''}`);
        if (data.objectCount != null) console.log(`[manifest] objectCount: ${data.objectCount}`);
        if (data.syncedAt) console.log(`[manifest] syncedAt: ${data.syncedAt}`);
    } catch {
        console.log(`[manifest] ${manifestKey} (${text.length} bytes, non-JSON)`);
    }
}

/**
 * @param {string} tenantId
 * @param {{ dryRun: boolean, limit: number }} opts
 */
async function mirrorTenantModels(tenantId, opts) {
    const idCheck = validateTenantIdForCreate(tenantId);
    if (!idCheck.ok) {
        throw new Error(idCheck.error || 'Invalid tenant id');
    }

    console.log(`[mirror] tenant=${tenantId} source=${META_MODELS_SOURCE_PREFIX} dryRun=${opts.dryRun} limit=${opts.limit}`);
    await printManifestProgress();

    const { objects } = await listObjects(META_MODELS_SOURCE_PREFIX, '');
    const stats = { listed: objects.length, copy: 0, skipIdentical: 0, skipExists: 0, skipMarker: 0, errors: 0 };

    let processed = 0;
    for (const obj of objects) {
        if (processed >= opts.limit) break;

        const destKey = mapMetaModelsKeyToTenantModelsKey(tenantId, obj.key);
        if (!destKey) {
            stats.skipMarker += 1;
            continue;
        }

        let action = 'copy';
        let sourceHead = null;
        let destHead = null;
        try {
            sourceHead = await headObject(obj.key);
            destHead = await headObject(destKey);
            action = decideMirrorAction(destHead, sourceHead ?? { size: obj.size });
        } catch (err) {
            stats.errors += 1;
            console.error(`[error] head ${obj.key}: ${err instanceof Error ? err.message : err}`);
            continue;
        }

        processed += 1;

        if (action === 'skip-identical') {
            stats.skipIdentical += 1;
            console.log(`[skip-identical] ${obj.key} -> ${destKey}`);
            continue;
        }
        if (action === 'skip-exists') {
            stats.skipExists += 1;
            console.log(`[skip-exists] ${obj.key} -> ${destKey} (dest differs; no overwrite)`);
            continue;
        }

        if (opts.dryRun) {
            stats.copy += 1;
            console.log(`[dry-run-copy] ${obj.key} -> ${destKey} (${obj.size} bytes)`);
            continue;
        }

        try {
            await copyObject(destKey, obj.key);
            stats.copy += 1;
            console.log(`[copied] ${obj.key} -> ${destKey} (${obj.size} bytes)`);
        } catch (err) {
            stats.errors += 1;
            console.error(`[error] copy ${obj.key}: ${err instanceof Error ? err.message : err}`);
        }
    }

    console.log('[summary]', JSON.stringify(stats));
    return stats;
}

async function main() {
    applyCloudAgentR2EnvFallback();

    const tenantId = process.argv[2];
    if (!tenantId || tenantId.startsWith('--')) {
        console.error('Usage: node scripts/r2-mirror-prefix-to-tenant-models.mjs <tenantId> [--dry-run] [--limit N]');
        process.exit(1);
    }

    const opts = parseArgs(process.argv.slice(3));

    if (!isR2Enabled()) {
        console.error('STORAGE_BACKEND=r2 と R2 認証情報を設定してください');
        process.exit(1);
    }

    try {
        await mirrorTenantModels(tenantId, opts);
    } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}