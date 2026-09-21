#!/usr/bin/env node
// scripts/migrate-tenant-assets-to-r2.mjs — ローカルテナントアセットを R2 へ一括移行

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { putObject } from '../lib/r2/r2-s3-client.js';
import { guessContentType, toR2Key } from '../lib/r2/r2-keys.js';
import { isR2Enabled } from '../lib/r2/storage-backend.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(projectRoot, '.env') });
dotenv.config({ path: path.join(projectRoot, '.env.local') });

const STORES = [
    { name: 'models', dir: 'models' },
    { name: 'pdfs', dir: 'pdfs' },
    { name: 'images', dir: 'images' },
    { name: 'env', dir: 'env' },
    { name: 'avatars', dir: 'avatars' },
];

/**
 * ディレクトリを再帰的に走査する
 * @param {string} dir
 * @param {string} baseDir
 * @yields {[string, string]}
 */
function* walkFiles(dir, baseDir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            yield* walkFiles(abs, baseDir);
        } else if (entry.isFile()) {
            const rel = path.relative(baseDir, abs).split(path.sep).join('/');
            yield [rel, abs];
        }
    }
}

/**
 * @param {string} tenantId
 */
async function migrateTenant(tenantId) {
    const tenantRoot = path.join(projectRoot, 'tenants', tenantId);
    if (!fs.existsSync(tenantRoot)) {
        console.warn(`[skip] tenant not found: ${tenantId}`);
        return;
    }

    let uploaded = 0;
    for (const store of STORES) {
        const storeDir = path.join(tenantRoot, store.dir);
        for (const [rel, abs] of walkFiles(storeDir, storeDir)) {
            const r2Key = toR2Key(tenantId, store.name, rel);
            const body = fs.readFileSync(abs);
            await putObject(r2Key, body, guessContentType(rel));
            uploaded += 1;
            console.log(`  put ${r2Key} (${body.length} bytes)`);
        }
    }
    console.log(`[done] ${tenantId}: ${uploaded} objects`);
}

async function main() {
    if (!isR2Enabled()) {
        console.error('STORAGE_BACKEND=r2 と R2 認証情報を .env に設定してください');
        process.exit(1);
    }

    const tenantsDir = path.join(projectRoot, 'tenants');
    const argTenant = process.argv[2];
    const tenantIds = argTenant
        ? [argTenant]
        : fs
              .readdirSync(tenantsDir, { withFileTypes: true })
              .filter((d) => d.isDirectory() && !d.name.startsWith('_'))
              .map((d) => d.name);

    for (const tenantId of tenantIds) {
        console.log(`Migrating ${tenantId}...`);
        await migrateTenant(tenantId);
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
