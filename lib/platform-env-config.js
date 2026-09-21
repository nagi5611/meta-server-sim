// lib/platform-env-config.js — 環境変数統合（.env > env-config.json > 既定値）

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import {
    ENV_GROUP_LABELS,
    ENV_META_ONLY_KEYS,
    PLATFORM_ENV_DEFINITIONS,
    getEnvDefinition,
    getRestartRequiredKeys,
    isEnvFileSecret,
} from './platform-env-schema.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const CONFIG_DIR = path.join(PROJECT_ROOT, 'data', 'platform');
export const ENV_CONFIG_PATH = path.join(CONFIG_DIR, 'env-config.json');

const MASK_PLACEHOLDER = '••••••••';
const ENV_CONFIG_ENC_PREFIX = 'v1:';

/** @type {Record<string, string> | null} */
let cachedFileValues = null;

/**
 * ログ用にエラーメッセージをサニタイズ（値を含めない）
 * @param {unknown} err
 * @returns {string}
 */
function safeErrorMessage(err) {
    if (!(err instanceof Error)) return 'unknown error';
    return err.message.replace(/[A-Za-z0-9+/=_-]{20,}/g, '[redacted]');
}

/**
 * @returns {Buffer | null}
 */
function getEnvConfigEncryptionKey() {
    const raw = String(process.env.ENV_CONFIG_ENCRYPTION_KEY ?? '').trim();
    if (!raw) return null;
    try {
        const key = Buffer.from(raw, 'base64');
        if (key.length === 32) return key;
    } catch {
        /* fall through */
    }
    const key = crypto.createHash('sha256').update(raw, 'utf8').digest();
    return key;
}

/**
 * @param {string} plaintext
 * @returns {string}
 */
function encryptEnvConfigPayload(plaintext) {
    const key = getEnvConfigEncryptionKey();
    if (!key) return plaintext;
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENV_CONFIG_ENC_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${enc.toString('base64')}\n`;
}

/**
 * @param {string} fileBody
 * @returns {string}
 */
function decryptEnvConfigPayload(fileBody) {
    const trimmed = fileBody.trim();
    if (!trimmed.startsWith(ENV_CONFIG_ENC_PREFIX)) {
        return fileBody;
    }
    const key = getEnvConfigEncryptionKey();
    if (!key) {
        throw new Error('env-config is encrypted but ENV_CONFIG_ENCRYPTION_KEY is not set');
    }
    const parts = trimmed.slice(ENV_CONFIG_ENC_PREFIX.length).split(':');
    if (parts.length !== 3) {
        throw new Error('invalid encrypted env-config format');
    }
    const iv = Buffer.from(parts[0], 'base64');
    const tag = Buffer.from(parts[1], 'base64');
    const data = Buffer.from(parts[2], 'base64');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

/**
 * @param {Record<string, unknown>} raw
 * @returns {{ values: Record<string, string>, strippedSecretKeys: string[] }}
 */
function parseEnvConfigObject(raw) {
    const values = {};
    const strippedSecretKeys = [];
    if (!raw || typeof raw !== 'object') {
        return { values, strippedSecretKeys };
    }
    for (const def of PLATFORM_ENV_DEFINITIONS) {
        const v = raw[def.key];
        if (v === undefined || v === null || String(v).trim() === '') {
            continue;
        }
        if (isEnvFileSecret(def.key)) {
            strippedSecretKeys.push(def.key);
            continue;
        }
        values[def.key] = String(v);
    }
    return { values, strippedSecretKeys };
}

/**
 * @param {string} key
 * @returns {boolean}
 */
export function isEnvLockedByDotEnv(key) {
    if (ENV_META_ONLY_KEYS.has(key)) {
        return true;
    }
    const raw = process.env[key];
    return raw !== undefined && String(raw).trim() !== '';
}

/**
 * @returns {number}
 */
export function getAdminEnvSecretLevel() {
    const raw = String(process.env.ADMIN_ENV_SECRET_LEVEL ?? '1').trim();
    const level = parseInt(raw, 10);
    if (level === 2) return 2;
    return 1;
}

/**
 * @returns {Set<string>}
 */
export function getAdminEnvMaskKeys() {
    const set = new Set();
    const raw = String(process.env.ADMIN_ENV_MASK_KEYS ?? '').trim();
    if (!raw) return set;
    for (const part of raw.split(/[\r\n,]+/)) {
        const k = part.trim();
        if (k) set.add(k);
    }
    return set;
}

/**
 * @param {string} key
 * @param {boolean} fromFile
 * @returns {boolean}
 */
export function shouldMaskEnvValueForAdmin(key, fromFile) {
    if (!fromFile) return false;
    const level = getAdminEnvSecretLevel();
    if (level === 2) return true;
    return getAdminEnvMaskKeys().has(key);
}

/**
 * ファイル設定を読み込む
 * @returns {Record<string, string>}
 */
function loadEnvConfigFromDisk() {
    try {
        if (!fs.existsSync(ENV_CONFIG_PATH)) return {};
        const fileBody = fs.readFileSync(ENV_CONFIG_PATH, 'utf8');
        const jsonText = decryptEnvConfigPayload(fileBody);
        const raw = JSON.parse(jsonText);
        const { values, strippedSecretKeys } = parseEnvConfigObject(raw);
        if (strippedSecretKeys.length > 0) {
            writeEnvConfigPayloadToDisk(values);
            console.warn(
                `[env-config] removed ${strippedSecretKeys.length} secret key(s) from disk; set them in .env`
            );
        }
        return values;
    } catch (e) {
        console.warn('[env-config] failed to read:', safeErrorMessage(e));
        return {};
    }
}

/**
 * @returns {Record<string, string>}
 */
function getFileValues() {
    if (!cachedFileValues) {
        cachedFileValues = loadEnvConfigFromDisk();
    }
    return cachedFileValues;
}

/**
 * キャッシュを破棄して再読み込み
 */
export function reloadEnvConfig() {
    cachedFileValues = null;
    return getFileValues();
}

/**
 * 有効な環境変数値を取得する
 * @param {string} key
 * @returns {string | undefined}
 */
export function getPlatformEnv(key) {
    if (isEnvLockedByDotEnv(key)) {
        const raw = process.env[key];
        return raw !== undefined ? String(raw) : undefined;
    }
    const fileVals = getFileValues();
    if (fileVals[key] !== undefined) {
        return fileVals[key];
    }
    const def = getEnvDefinition(key);
    if (def?.defaultValue !== undefined) {
        return def.defaultValue;
    }
    return undefined;
}

/**
 * @param {string} key
 * @returns {'env'|'file'|'default'|'unset'}
 */
export function getPlatformEnvSource(key) {
    if (isEnvLockedByDotEnv(key)) return 'env';
    const fileVals = getFileValues();
    if (fileVals[key] !== undefined) return 'file';
    const def = getEnvDefinition(key);
    if (def?.defaultValue !== undefined) return 'default';
    return 'unset';
}

/**
 * @param {Record<string, string>} values
 */
/**
 * @param {Record<string, string>} values
 */
function writeEnvConfigPayloadToDisk(values) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
    const payload = {};
    for (const def of PLATFORM_ENV_DEFINITIONS) {
        if (isEnvFileSecret(def.key)) continue;
        if (values[def.key] !== undefined && String(values[def.key]).trim() !== '') {
            payload[def.key] = String(values[def.key]);
        }
    }
    const plain = `${JSON.stringify(payload, null, 2)}\n`;
    const body = encryptEnvConfigPayload(plain);
    fs.writeFileSync(ENV_CONFIG_PATH, body, { mode: 0o600 });
    cachedFileValues = payload;
}

/**
 * @param {Record<string, string>} values
 */
function saveEnvConfigToDisk(values) {
    writeEnvConfigPayloadToDisk(values);
}

/**
 * 管理 API 用の一覧
 */
export function getEnvConfigForAdmin() {
    const fileVals = getFileValues();
    const secretLevel = getAdminEnvSecretLevel();
    const maskKeys = getAdminEnvMaskKeys();
    const groups = {};

    for (const def of PLATFORM_ENV_DEFINITIONS) {
        const envOnlySecret = isEnvFileSecret(def.key);
        const locked = isEnvLockedByDotEnv(def.key) || envOnlySecret;
        const source = getPlatformEnvSource(def.key);
        const fromFile = source === 'file';
        const masked =
            envOnlySecret ||
            shouldMaskEnvValueForAdmin(def.key, fromFile);

        let displayValue = '';
        let configured = false;

        if (envOnlySecret) {
            const effective = String(getPlatformEnv(def.key) ?? '').trim();
            configured = effective !== '';
            displayValue = configured ? MASK_PLACEHOLDER : '';
        } else if (locked) {
            configured = true;
            displayValue = '';
        } else if (fromFile) {
            configured = true;
            displayValue = masked ? MASK_PLACEHOLDER : (fileVals[def.key] ?? '');
        } else if (source === 'default') {
            displayValue = def.defaultValue ?? '';
        }

        const entry = {
            key: def.key,
            label: def.label,
            description: def.description ?? '',
            multiline: !!def.multiline,
            restartRequired: def.restartRequired,
            locked,
            envOnly: envOnlySecret,
            masked,
            configured,
            source,
            value: displayValue,
            effectiveValue: locked || envOnlySecret ? '' : (getPlatformEnv(def.key) ?? ''),
        };

        if (!groups[def.group]) {
            groups[def.group] = {
                id: def.group,
                label: ENV_GROUP_LABELS[def.group] ?? def.group,
                items: [],
            };
        }
        groups[def.group].items.push(entry);
    }

    return {
        configPath: ENV_CONFIG_PATH,
        configExists: fs.existsSync(ENV_CONFIG_PATH),
        secretLevel,
        maskKeys: [...maskKeys],
        groups: Object.values(groups),
    };
}

/**
 * @param {Record<string, string | null | undefined>} updates
 * @returns {{ ok: true, requiresRestart: string[] } | { ok: false, errors: string[] }}
 */
export function saveEnvConfigFromAdmin(updates) {
    const errors = [];
    const fileVals = { ...getFileValues() };
    const changedKeys = [];

    for (const [key, rawValue] of Object.entries(updates ?? {})) {
        const def = getEnvDefinition(key);
        if (!def) {
            errors.push(`未知のキー: ${key}`);
            continue;
        }
        if (isEnvLockedByDotEnv(key)) {
            errors.push(`${key} は .env でロックされています`);
            continue;
        }
        const value = rawValue === null || rawValue === undefined ? '' : String(rawValue);
        const trimmed = value.trim();

        if (isEnvFileSecret(key)) {
            if (trimmed === '' || trimmed === MASK_PLACEHOLDER) {
                continue;
            }
            errors.push(`${key} は機密のため .env に設定してください（env-config.json には保存しません）`);
            continue;
        }

        if (trimmed === '') {
            if (fileVals[key] !== undefined) {
                delete fileVals[key];
                changedKeys.push(key);
            }
            continue;
        }

        if (key === 'PORT') {
            const port = parseInt(trimmed, 10);
            if (!Number.isFinite(port) || port < 1 || port > 65535) {
                errors.push('PORT は 1–65535 の整数である必要があります');
            }
        }

        if (key === 'STORAGE_BACKEND') {
            const low = trimmed.toLowerCase();
            if (low !== 'local' && low !== 'r2') {
                errors.push('STORAGE_BACKEND は local または r2 である必要があります');
            }
        }

        if (fileVals[key] !== trimmed) {
            fileVals[key] = trimmed;
            changedKeys.push(key);
        }
    }

    if (errors.length > 0) {
        return { ok: false, errors };
    }

    saveEnvConfigToDisk(fileVals);

    const restartKeys = getRestartRequiredKeys();
    const requiresRestart = changedKeys.filter((k) => restartKeys.has(k));

    return { ok: true, requiresRestart, changedKeys };
}

/**
 * テスト用: キャッシュとファイル状態をリセット
 */
export function _resetEnvConfigCacheForTests() {
    cachedFileValues = null;
}
