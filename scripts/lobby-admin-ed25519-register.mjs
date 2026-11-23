#!/usr/bin/env node
/**
 * D1 に admin Ed25519 公開鍵を 1 件登録する（オフライン用 SQL 生成）。
 * 秘密鍵は扱わない。
 *
 * Usage:
 *   node scripts/lobby-admin-ed25519-register.mjs --name "bootstrap" --public-b64 "BASE64..."
 *   node scripts/lobby-admin-ed25519-register.mjs --name "bootstrap" --public-b64 "..." --sql-only
 */
import crypto from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
    options: {
        name: { type: 'string' },
        'public-b64': { type: 'string' },
        'sql-only': { type: 'boolean', default: false },
    },
});

const name = String(values.name || '').trim();
const publicB64 = String(values['public-b64'] || '').trim();
if (!name || !publicB64) {
    console.error('Usage: --name NAME --public-b64 BASE64_RAW_32');
    process.exit(1);
}
let bytes;
try {
    bytes = Buffer.from(publicB64, 'base64');
} catch {
    console.error('invalid base64');
    process.exit(1);
}
if (bytes.length !== 32) {
    console.error('public key must be 32 bytes raw Ed25519');
    process.exit(1);
}
const fingerprint = crypto.createHash('sha256').update(bytes).digest('hex');
const id = crypto.randomUUID();
const createdAt = new Date().toISOString();
const sql = `INSERT INTO admin_ed25519_keys (id, name, public_key_b64, fingerprint, created_at, last_used_at, disabled_at, created_ip, created_ua)
VALUES ('${id}', '${name.replace(/'/g, "''")}', '${publicB64}', '${fingerprint}', '${createdAt}', NULL, NULL, 'cli', 'lobby-admin-ed25519-register.mjs');`;

if (values['sql-only']) {
    console.log(sql);
} else {
    console.log('-- fingerprint sha256:', fingerprint);
    console.log('-- fingerprint short:', fingerprint.slice(0, 16));
    console.log(sql);
    console.error('Apply with: wrangler d1 execute lobby-ops --remote --command "..."');
}