// db/users-path.js — プラットフォーム共有 users.db（D1 フォールバック用）

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

/**
 * @returns {string}
 */
export function getPlatformUsersDbPath() {
    const fromEnv = process.env.USERS_DB_PATH?.trim();
    if (fromEnv) return path.resolve(fromEnv);
    return path.join(REPO_ROOT, 'data', 'users.db');
}

/**
 * @param {string} dbPath
 */
export function ensurePlatformUsersDbDir(dbPath = getPlatformUsersDbPath()) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
}
