// lib/env-file-permissions.js — 起動時 .env 権限チェック（警告のみ、起動は継続）

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const PROJECT_ROOT = path.resolve(__dirname, '..');
export const DEFAULT_ENV_FILE = path.join(PROJECT_ROOT, '.env');

/** 本番 fleet の systemd が動く想定 OS ユーザー */
export const DEFAULT_EXPECTED_ENV_OWNER = 'nagi';

/**
 * @param {number} mode — stat mode の下位 9 ビット相当（0o777）
 * @returns {boolean}
 */
export function isEnvModeTooPermissive(mode) {
    return (mode & 0o077) !== 0;
}

/**
 * @param {string} envPath
 * @returns {{ mode: number, owner: string | null }}
 */
export function readEnvFileStat(envPath) {
    const stat = fs.statSync(envPath);
    const mode = stat.mode & 0o777;
    let owner = null;
    if (process.platform !== 'win32') {
        try {
            owner = execFileSync('stat', ['-c', '%U', envPath], { encoding: 'utf8' }).trim();
        } catch {
            owner = null;
        }
    }
    return { mode, owner };
}

/**
 * 期待する .env 所有者名（未設定かつ非本番なら所有者チェックは省略）
 * @param {{ expectedOwner?: string }} [options]
 * @returns {string}
 */
export function resolveExpectedEnvOwner(options = {}) {
    if (options.expectedOwner !== undefined) {
        return String(options.expectedOwner).trim();
    }
    const fromEnv = String(process.env.ENV_FILE_EXPECTED_OWNER ?? '').trim();
    if (fromEnv) return fromEnv;
    if (process.env.NODE_ENV === 'production') return DEFAULT_EXPECTED_ENV_OWNER;
    return '';
}

/**
 * .env が group/other 読取可、または所有者が想定と異なる場合に警告ログ（chmod はしない）
 * @param {{ envPath?: string, expectedOwner?: string }} [options]
 */
export function warnIfEnvFileInsecure(options = {}) {
    if (process.platform === 'win32') return;

    const envPath = options.envPath ?? DEFAULT_ENV_FILE;
    const expectedOwner = resolveExpectedEnvOwner(options);

    try {
        if (!fs.existsSync(envPath)) return;

        const { mode, owner } = readEnvFileStat(envPath);

        if (isEnvModeTooPermissive(mode)) {
            console.warn(
                `[security] ${envPath} mode ${mode.toString(8)} allows group/other access; ` +
                    'set mode 0600 (see docs/security/env-file-permissions.md or scripts/secure-fleet-env-permissions.sh)'
            );
        }

        if (expectedOwner && owner && owner !== expectedOwner) {
            console.warn(
                `[security] ${envPath} owner is ${owner}, expected ${expectedOwner}; ` +
                    'service user should own the file (see docs/security/env-file-permissions.md)'
            );
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.warn(`[security] could not stat .env file at ${envPath}:`, msg);
    }
}