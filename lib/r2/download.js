// lib/r2/download.js — R2 ダウンロード

import { PRESIGN_EXPIRES_SEC } from './constants.js';
import { presignGetObject, isR2PresignConfigured } from './r2-presign.js';
import { getObject } from './r2-s3-client.js';
import { guessContentType } from './r2-keys.js';

/**
 * ダウンロードモードを返す
 * @returns {'direct' | 'proxy'}
 */
export function getDownloadMode() {
    return isR2PresignConfigured() ? 'direct' : 'proxy';
}

/**
 * presigned GET URL を取得する
 * @param {string} r2Key
 * @param {string} filename
 * @returns {Promise<{ url: string, filename: string, expiresIn: number }>}
 */
export async function getPresignedDownloadUrl(r2Key, filename) {
    const url = await presignGetObject(r2Key, {
        responseContentType: guessContentType(filename),
        responseContentDisposition: `inline; filename="${encodeURIComponent(filename)}"`,
    });
    return { url, filename, expiresIn: PRESIGN_EXPIRES_SEC };
}

/**
 * R2 オブジェクトをストリーム取得する
 * @param {string} r2Key
 * @returns {Promise<{ stream: import('stream').Readable, contentType: string, contentLength?: number } | null>}
 */
export async function streamObject(r2Key) {
    const obj = await getObject(r2Key);
    if (!obj) return null;
    const filename = r2Key.split('/').pop() ?? 'download';
    return {
        stream: obj.body,
        contentType: obj.contentType || guessContentType(filename),
        contentLength: obj.contentLength,
    };
}
