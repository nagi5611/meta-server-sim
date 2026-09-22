// lib/r2/storage-backend.js — ストレージバックエンド切替

import { R2_BUCKET_DEFAULT, R2_KEY_PREFIX_DEFAULT } from './constants.js';
import { getPlatformEnv } from '../platform-env-config.js';

/**
 * @returns {boolean}
 */
export function isR2Enabled() {
    return String(getPlatformEnv('STORAGE_BACKEND') || 'local').trim().toLowerCase() === 'r2';
}

/**
 * R2 S3 API 用の認証情報が揃っているか
 * @param {ReturnType<typeof getR2Env>} [env]
 * @returns {boolean}
 */
export function isR2CredentialsConfigured(env = getR2Env()) {
    return Boolean(
        env.R2_ACCOUNT_ID?.trim() &&
            env.R2_ACCESS_KEY_ID?.trim() &&
            env.R2_SECRET_ACCESS_KEY?.trim()
    );
}

/**
 * R2 環境変数オブジェクト
 * @returns {{ R2_ACCESS_KEY_ID?: string, R2_SECRET_ACCESS_KEY?: string, R2_ACCOUNT_ID?: string, R2_BUCKET_NAME?: string, R2_KEY_PREFIX?: string }}
 */
export function getR2Env() {
    return {
        R2_ACCESS_KEY_ID: getPlatformEnv('R2_ACCESS_KEY_ID'),
        R2_SECRET_ACCESS_KEY: getPlatformEnv('R2_SECRET_ACCESS_KEY'),
        R2_ACCOUNT_ID: getPlatformEnv('R2_ACCOUNT_ID'),
        R2_BUCKET_NAME: getPlatformEnv('R2_BUCKET_NAME'),
        R2_KEY_PREFIX: getPlatformEnv('R2_KEY_PREFIX'),
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
    if (!isR2Enabled() || !isR2CredentialsConfigured()) {
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
