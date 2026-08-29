// lib/r2/storage-backend.js — ストレージバックエンド切替

import { R2_BUCKET_DEFAULT, R2_KEY_PREFIX_DEFAULT } from './constants.js';

/**
 * @returns {boolean}
 */
export function isR2Enabled() {
    return String(process.env.STORAGE_BACKEND || 'local').trim().toLowerCase() === 'r2';
}

/**
 * R2 環境変数オブジェクト
 * @returns {{ R2_ACCESS_KEY_ID?: string, R2_SECRET_ACCESS_KEY?: string, R2_ACCOUNT_ID?: string, R2_BUCKET_NAME?: string, R2_KEY_PREFIX?: string }}
 */
export function getR2Env() {
    return {
        R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
        R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
        R2_ACCOUNT_ID: process.env.R2_ACCOUNT_ID,
        R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
        R2_KEY_PREFIX: process.env.R2_KEY_PREFIX,
    };
}

/**
 * @param {ReturnType<typeof getR2Env>} env
 * @returns {string}
 */
export function getBucketName(env = getR2Env()) {
    return env.R2_BUCKET_NAME?.trim() || R2_BUCKET_DEFAULT;
}

/**
 * @param {ReturnType<typeof getR2Env>} env
 * @returns {string}
 */
export function getKeyPrefix(env = getR2Env()) {
    const p = env.R2_KEY_PREFIX?.trim();
    return p || R2_KEY_PREFIX_DEFAULT;
}

/**
 * client-config 用ストレージ設定
 * @param {string} tenantId
 * @returns {{ storageBackend: string, assetModels: { mode: string, signEndpoint?: string } }}
 */
export function getClientStorageConfig(tenantId) {
    if (!isR2Enabled()) {
        return {
            storageBackend: 'local',
            assetModels: { mode: 'local' },
        };
    }
    const tid = encodeURIComponent(tenantId);
    return {
        storageBackend: 'r2',
        assetModels: {
            mode: 'local',
            signEndpoint: `/${tid}/api/sign-asset-urls`,
        },
    };
}
