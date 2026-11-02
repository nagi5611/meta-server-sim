// lib/d1/d1-config.js — D1 database id / account (wrangler.toml + env)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPlatformEnv } from '../platform-env-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WRANGLER_PATH = path.join(__dirname, '..', '..', 'wrangler.toml');

/** @type {{ databaseId: string, databaseName: string, binding: string } | null} */
let parsedWrangler = null;

/**
 * @returns {{ databaseId: string, databaseName: string, binding: string } | null}
 */
function readWranglerD1() {
    if (parsedWrangler !== null) return parsedWrangler;
    parsedWrangler = null;
    if (!fs.existsSync(WRANGLER_PATH)) return null;
    const raw = fs.readFileSync(WRANGLER_PATH, 'utf8');
    const block = raw.match(/\[\[d1_databases\]\][\s\S]*?(?=\n\[|\n*$)/);
    if (!block) return null;
    const databaseId = block[0].match(/database_id\s*=\s*"([^"]+)"/)?.[1]?.trim();
    const databaseName = block[0].match(/database_name\s*=\s*"([^"]+)"/)?.[1]?.trim();
    const binding = block[0].match(/binding\s*=\s*"([^"]+)"/)?.[1]?.trim();
    if (!databaseId || !databaseName) return null;
    parsedWrangler = {
        databaseId,
        databaseName,
        binding: binding || 'DB',
    };
    return parsedWrangler;
}

/**
 * @returns {string}
 */
export function getD1DatabaseName() {
    const fromEnv = getPlatformEnv('D1_DATABASE_NAME')?.trim();
    if (fromEnv) return fromEnv;
    return readWranglerD1()?.databaseName || 'metaverse-sim';
}

/**
 * @returns {string}
 */
export function getD1DatabaseId() {
    const fromEnv = getPlatformEnv('D1_DATABASE_ID')?.trim();
    if (fromEnv) return fromEnv;
    const fromWrangler = readWranglerD1()?.databaseId;
    if (fromWrangler) return fromWrangler;
    return '';
}

/**
 * Wrangler binding 名（Workers 用。Node HTTP クライアントでは database_id を使用）
 * @returns {string}
 */
export function getD1BindingName() {
    const fromEnv = getPlatformEnv('D1_BINDING_NAME')?.trim();
    if (fromEnv) return fromEnv;
    return readWranglerD1()?.binding || 'METASIM_USERS';
}

/**
 * @returns {string}
 */
export function getCloudflareAccountId() {
    const a =
        getPlatformEnv('CLOUDFLARE_ACCOUNT_ID')?.trim() ||
        getPlatformEnv('R2_ACCOUNT_ID')?.trim() ||
        process.env.CLOUDFLARE_ACCOUNT_ID?.trim() ||
        process.env.R2_ACCOUNT_ID?.trim();
    return a || '';
}

/**
 * @returns {string}
 */
export function getCloudflareApiToken() {
    return (
        getPlatformEnv('CLOUDFLARE_API_TOKEN')?.trim() ||
        process.env.CLOUDFLARE_API_TOKEN?.trim() ||
        ''
    );
}

/**
 * @returns {boolean}
 */
export function isD1UsersConfigured() {
    return Boolean(getD1DatabaseId() && getCloudflareAccountId() && getCloudflareApiToken());
}
