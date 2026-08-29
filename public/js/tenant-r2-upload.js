// public/js/tenant-r2-upload.js — R2 presigned アップロード（ScienceHUB cloud-storage 縮小版）

import { ADMIN_CSRF_HEADER, getAdminCsrfTokenSync } from './admin-api-fetch.js';

const MULTIPART_THRESHOLD = 30 * 1024 * 1024;
const PARALLEL_SMALL_FILES = 8;

/**
 * @param {string} apiBase /admin/tenants/P-01
 * @param {string} path
 * @param {RequestInit} [options]
 */
async function r2ApiRequest(apiBase, path, options = {}) {
    const response = await fetch(`${apiBase}/r2-storage/${path}`, {
        credentials: 'include',
        ...options,
        headers: {
            ...(options.body instanceof ArrayBuffer || options.body instanceof Blob
                ? {}
                : { 'Content-Type': 'application/json' }),
            [ADMIN_CSRF_HEADER]: getAdminCsrfTokenSync() || '',
            ...(options.headers ?? {}),
        },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error ?? `リクエストに失敗しました (${response.status})`);
    }
    return data;
}

/**
 * XHR PUT（presigned URL 用）
 * @param {string} url
 * @param {Blob} body
 * @param {{ onProgress?: (loaded: number, total: number) => void }} [options]
 * @returns {Promise<{ etag: string | null }>}
 */
function xhrPut(url, body, options = {}) {
    const { onProgress } = options;
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url);
        xhr.upload.addEventListener('progress', (event) => {
            if (onProgress && event.lengthComputable) {
                onProgress(event.loaded, event.total);
            }
        });
        xhr.addEventListener('load', () => {
            if (xhr.status < 200 || xhr.status >= 300) {
                reject(new Error(`アップロードに失敗しました (${xhr.status})`));
                return;
            }
            resolve({ etag: xhr.getResponseHeader('ETag') });
        });
        xhr.addEventListener('error', () => reject(new Error('アップロードに失敗しました')));
        xhr.addEventListener('abort', () => reject(new Error('アップロードが中断されました')));
        xhr.send(body);
    });
}

/**
 * @param {string} apiBase
 * @param {string} sessionId
 * @param {File} file
 * @param {(ratio: number) => void} [onProgress]
 */
async function uploadSimpleDirect(apiBase, sessionId, file, onProgress) {
    const { url } = await r2ApiRequest(
        apiBase,
        `upload/url?sessionId=${encodeURIComponent(sessionId)}`
    );
    await xhrPut(url, file, {
        onProgress: (loaded, total) => {
            if (onProgress && total > 0) onProgress(loaded / total);
        },
    });
    return r2ApiRequest(apiBase, 'upload/complete', {
        method: 'POST',
        body: JSON.stringify({ sessionId }),
    });
}

/**
 * @param {string} apiBase
 * @param {string} sessionId
 * @param {File} file
 * @param {number} partSize
 * @param {number} totalParts
 * @param {number} parallel
 * @param {(ratio: number) => void} [onProgress]
 */
async function uploadPartsDirect(apiBase, sessionId, file, partSize, totalParts, parallel, onProgress) {
    const uploadedParts = [];
    let completedBytes = 0;

    async function uploadOne(partNumber) {
        const start = (partNumber - 1) * partSize;
        const end = Math.min(start + partSize, file.size);
        const chunk = file.slice(start, end);
        const { url } = await r2ApiRequest(
            apiBase,
            `upload/part-url?sessionId=${encodeURIComponent(sessionId)}&partNumber=${partNumber}`
        );
        const { etag } = await xhrPut(url, chunk);
        if (!etag) throw new Error(`パート ${partNumber} の ETag が取得できませんでした`);
        uploadedParts.push({ partNumber, etag });
        completedBytes += chunk.size;
        if (onProgress) onProgress(Math.min(completedBytes / file.size, 1));
    }

    const queue = Array.from({ length: totalParts }, (_, i) => i + 1);
    const workers = Array.from({ length: Math.min(parallel, totalParts) }, async () => {
        while (queue.length > 0) {
            const partNumber = queue.shift();
            if (partNumber === undefined) break;
            await uploadOne(partNumber);
        }
    });
    await Promise.all(workers);

    uploadedParts.sort((a, b) => a.partNumber - b.partNumber);
    return r2ApiRequest(apiBase, 'upload/complete', {
        method: 'POST',
        body: JSON.stringify({ sessionId, parts: uploadedParts, directUpload: true }),
    });
}

/**
 * プロキシ経由の単発アップロード
 * @param {string} apiBase
 * @param {string} sessionId
 * @param {File} file
 * @param {(ratio: number) => void} [onProgress]
 */
async function uploadSimpleProxy(apiBase, sessionId, file, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', `${apiBase}/r2-storage/upload/simple?sessionId=${encodeURIComponent(sessionId)}`);
        xhr.withCredentials = true;
        xhr.setRequestHeader(ADMIN_CSRF_HEADER, getAdminCsrfTokenSync() || '');
        xhr.upload.addEventListener('progress', (ev) => {
            if (onProgress && ev.lengthComputable) onProgress(ev.loaded / ev.total);
        });
        xhr.addEventListener('load', () => {
            if (xhr.status < 200 || xhr.status >= 300) {
                reject(new Error(`アップロードに失敗しました (${xhr.status})`));
                return;
            }
            try {
                resolve(JSON.parse(xhr.responseText || '{}'));
            } catch {
                reject(new Error('アップロード応答の解析に失敗しました'));
            }
        });
        xhr.addEventListener('error', () => reject(new Error('アップロードに失敗しました')));
        const form = new FormData();
        form.append('file', file);
        xhr.send(form);
    });
}

/**
 * R2 経由でファイルをアップロードする
 * @param {string} apiBase /admin/tenants/P-01
 * @param {string} store models|pdfs|images|env|avatars
 * @param {File} file
 * @param {{ relativeDir?: string, allowOverwrite?: boolean, forceFilename?: string, onProgress?: (ratio: number) => void }} [options]
 * @returns {Promise<{ success: boolean, filename?: string, error?: string, status?: number }>}
 */
export async function uploadFileViaR2(apiBase, store, file, options = {}) {
    const { relativeDir = '', allowOverwrite = false, forceFilename, onProgress } = options;

    try {
        const init = await r2ApiRequest(apiBase, 'upload/init', {
            method: 'POST',
            body: JSON.stringify({
                store,
                path: relativeDir,
                filename: file.name,
                size: file.size,
                allowOverwrite,
                forceFilename,
            }),
        });

        if (init.mode === 'simple') {
            if (init.directUpload) {
                const result = await uploadSimpleDirect(apiBase, init.sessionId, file, onProgress);
                return { success: true, status: 200, filename: result.filename ?? init.resolvedFilename };
            }
            const result = await uploadSimpleProxy(apiBase, init.sessionId, file, onProgress);
            return { success: true, status: 200, filename: result.filename ?? init.resolvedFilename };
        }

        if (init.directUpload) {
            const result = await uploadPartsDirect(
                apiBase,
                init.sessionId,
                file,
                init.partSize,
                init.totalParts,
                init.parallel ?? PARALLEL_SMALL_FILES,
                onProgress
            );
            return { success: true, status: 200, filename: result.filename ?? init.resolvedFilename };
        }

        throw new Error('マルチパートのプロキシアップロードは未対応です。R2 presign 設定を確認してください。');
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (message.includes('file_exists') || message.includes('既に')) {
            return { success: false, status: 409, error: 'file_exists' };
        }
        return { success: false, status: 400, error: message };
    }
}

/**
 * FormData からアップロード種別を判定する
 * @param {FormData} form
 * @returns {{ store: string, forceFilename?: string } | null}
 */
export function detectUploadStoreFromForm(form) {
    if (form.has('model')) return { store: 'models' };
    if (form.has('pdf')) return { store: 'pdfs' };
    if (form.has('hdr')) return { store: 'env', forceFilename: 'default.hdr' };
    if (form.has('avatar')) return { store: 'avatars' };
    return null;
}

/**
 * FormData から File を取得する
 * @param {FormData} form
 * @returns {File | null}
 */
export function getFileFromUploadForm(form) {
    for (const key of ['model', 'pdf', 'hdr', 'avatar', 'zip']) {
        const val = form.get(key);
        if (val instanceof File) return val;
    }
    return null;
}

/**
 * URL に confirm=1 が含まれるか
 * @param {string} url
 */
export function urlHasConfirmOverwrite(url) {
    try {
        const u = new URL(url, window.location.origin);
        return u.searchParams.get('confirm') === '1';
    } catch {
        return url.includes('confirm=1');
    }
}

/**
 * アップロード URL かどうか
 * @param {string} url
 * @param {string} method
 */
export function isAdminUploadUrl(url, method) {
    if (String(method || 'GET').toUpperCase() !== 'POST') return false;
    return /\/upload(?:-pdf|-hdr|-avatar|-prefab-zip|-plane-prefab-zip|-fds-smoke-zip)?(?:\?|$)/.test(url);
}

export { MULTIPART_THRESHOLD };
