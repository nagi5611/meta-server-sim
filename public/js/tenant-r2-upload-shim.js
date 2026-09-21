// public/js/tenant-r2-upload-shim.js — R2 モード時に setting.js の multer POST を presign フローへ差し替え

import { rewriteTenantWorldEditApiUrl } from './tenant-world-edit-api-paths.js';
import {
    detectUploadStoreFromForm,
    getFileFromUploadForm,
    isAdminUploadUrl,
    uploadFileViaR2,
    urlHasConfirmOverwrite,
} from './tenant-r2-upload.js';

/** @type {boolean | null} */
let r2ModeCache = null;

/** サーバー POST /upload 実行中の XHR 数（キュー表示と進捗用） */
let inflightServerModelUploads = 0;

/**
 * client-config から R2 モードか判定する
 * @returns {Promise<boolean>}
 */
async function isR2StorageMode() {
    if (r2ModeCache !== null) return r2ModeCache;
    try {
        const url = rewriteTenantWorldEditApiUrl('/api/client-config');
        const res = await fetch(url, { credentials: 'include' });
        if (!res.ok) {
            r2ModeCache = false;
            return false;
        }
        const cfg = await res.json();
        r2ModeCache = cfg.storageBackend === 'r2';
        return r2ModeCache;
    } catch {
        r2ModeCache = false;
        return false;
    }
}

/**
 * アップロード URL から API ベースを抽出する
 * @param {string} url
 * @returns {string | null}
 */
function extractApiBase(url) {
    const match = String(url).match(/^(\/admin\/tenants\/[^/]+)/);
    return match?.[1] ?? null;
}

/**
 * GLB はテクスチャリサイズの有無にかかわらずサーバー POST /upload へ委譲する。
 * R2 直アップロードは setting.js の XHR 完了・キュー同期と整合しない。
 * @param {FormData} _form
 * @param {File} file
 */
export function shouldUseServerGlbUpload(_form, file) {
    return String(file.name || '').toLowerCase().endsWith('.glb');
}

/**
 * サーバー POST /upload の進行中を追跡する（model-upload-queue の processing 補正用）
 * @param {XMLHttpRequest} xhr
 */
function trackServerModelUpload(xhr) {
    inflightServerModelUploads += 1;
    const release = () => {
        inflightServerModelUploads = Math.max(0, inflightServerModelUploads - 1);
    };
    xhr.addEventListener('load', release, { once: true });
    xhr.addEventListener('error', release, { once: true });
    xhr.addEventListener('abort', release, { once: true });
}

/**
 * model-upload-queue の processing をクライアント進行中と同期する
 * @param {string} url
 * @param {Response} res
 */
async function mergeModelUploadQueueResponse(url, res) {
    if (!url.includes('model-upload-queue')) return res;
    if (res.status !== 200 && res.status !== 304) return res;
    const q = await res.clone().json().catch(() => null);
    if (!q || typeof q.waiting !== 'number') return res;
    const merged = {
        ...q,
        processing: Boolean(q.processing) || inflightServerModelUploads > 0,
    };
    return new Response(JSON.stringify(merged), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });
}

/**
 * R2 直アップロード等で合成する XHR 応答を完了させる
 * @param {XMLHttpRequest} xhr
 * @param {number} status
 * @param {string} responseText
 */
function completeSyntheticXhr(xhr, status, responseText) {
    try {
        Object.defineProperty(xhr, 'status', { value: status, configurable: true });
        Object.defineProperty(xhr, 'responseText', { value: responseText, configurable: true });
        Object.defineProperty(xhr, 'readyState', { value: 4, configurable: true });
    } catch {
        /* 一部環境では defineProperty が失敗する */
    }
    xhr.dispatchEvent(new Event('readystatechange'));
    xhr.dispatchEvent(new Event('load'));
    xhr.dispatchEvent(new Event('loadend'));
}

/**
 * R2 直アップロード応答（setting.js の textureResize 表示用）
 * @param {FormData} form
 */
function buildR2DirectUploadPayload(result, form) {
    const skipTextureResize = form.get('skipTextureResize') === '1';
    const payload = {
        success: true,
        filename: result.filename,
    };
    if (skipTextureResize) {
        payload.textureResize = {
            applied: false,
            skippedByClient: true,
            message: 'テクスチャのリサイズを行わず、オリジナルの GLB を保存しました。',
        };
    }
    return payload;
}

export function installTenantR2UploadShim() {
    if (window.__tenantR2UploadShimInstalled) return;
    window.__tenantR2UploadShimInstalled = true;

    void isR2StorageMode();

    const origOpen = XMLHttpRequest.prototype.open;
    const origSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
        this.__tenantR2Method = String(method || 'GET').toUpperCase();
        this.__tenantR2Url = typeof url === 'string' ? rewriteTenantWorldEditApiUrl(url) : String(url);
        return origOpen.call(this, method, this.__tenantR2Url, ...rest);
    };

    XMLHttpRequest.prototype.send = function send(body) {
        const url = this.__tenantR2Url || '';
        const method = this.__tenantR2Method || 'GET';

        if (!(body instanceof FormData) || !isAdminUploadUrl(url, method)) {
            return origSend.call(this, body);
        }

        const xhr = this;
        const apiBase = extractApiBase(url);
        if (!apiBase) {
            return origSend.call(this, body);
        }

        const storeInfo = detectUploadStoreFromForm(body);
        const file = getFileFromUploadForm(body);
        if (!storeInfo || !file) {
            return origSend.call(this, body);
        }

        if (url.includes('fds-smoke-zip') || url.includes('prefab-zip')) {
            return origSend.call(this, body);
        }

        // GLB テクスチャリサイズはサーバー処理必須。isR2StorageMode() 待ちで送信が遅延し
        // 「アップロード中…」のまま止まるのを防ぐため同期的にネイティブ send へ委譲する。
        if (shouldUseServerGlbUpload(body, file)) {
            trackServerModelUpload(xhr);
            return origSend.call(xhr, body);
        }

        void (async () => {
            const useR2 = await isR2StorageMode();
            if (!useR2) {
                trackServerModelUpload(xhr);
                origSend.call(xhr, body);
                return;
            }

            const allowOverwrite = urlHasConfirmOverwrite(url);
            const onProgress = (ratio) => {
                const ev = new ProgressEvent('progress', {
                    lengthComputable: true,
                    loaded: ratio * file.size,
                    total: file.size,
                });
                xhr.upload.dispatchEvent(ev);
            };
            xhr.upload.dispatchEvent(
                new ProgressEvent('progress', {
                    lengthComputable: true,
                    loaded: 0,
                    total: file.size,
                })
            );

            try {
                const result = await uploadFileViaR2(apiBase, storeInfo.store, file, {
                    allowOverwrite,
                    forceFilename: storeInfo.forceFilename,
                    onProgress,
                });

                const responseText = JSON.stringify(
                    result.success
                        ? buildR2DirectUploadPayload(result, body)
                        : { error: result.error ?? 'upload_failed', filename: file.name }
                );
                completeSyntheticXhr(
                    xhr,
                    result.status ?? (result.success ? 200 : 400),
                    responseText
                );
            } catch (err) {
                completeSyntheticXhr(
                    xhr,
                    500,
                    JSON.stringify({
                        error: err instanceof Error ? err.message : 'upload_failed',
                    })
                );
            }
        })();
    };
}

/**
 * fetch ベースの HDR アップロードをインターセプトする
 */
export function installTenantR2FetchShim() {
    if (window.__tenantR2FetchShimInstalled) return;
    window.__tenantR2FetchShimInstalled = true;

    void isR2StorageMode();

    const origFetch = window.fetch.bind(window);

    window.fetch = async function tenantR2Fetch(input, init) {
        const url = typeof input === 'string' ? input : input instanceof Request ? input.url : String(input);
        const rewritten = rewriteTenantWorldEditApiUrl(url);
        const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();

        if (rewritten.includes('model-upload-queue') && method === 'GET') {
            const res = await origFetch(
                rewritten !== url
                    ? typeof input === 'string'
                        ? rewritten
                        : new Request(rewritten, input instanceof Request ? input : undefined)
                    : input,
                { ...init, cache: 'no-store' }
            );
            return mergeModelUploadQueueResponse(rewritten, res);
        }

        if (
            method === 'POST' &&
            isAdminUploadUrl(rewritten, method) &&
            init?.body instanceof FormData &&
            !rewritten.includes('fds-smoke-zip') &&
            !rewritten.includes('prefab-zip')
        ) {
            const useR2 = await isR2StorageMode();
            const storeInfo = detectUploadStoreFromForm(init.body);
            const file = getFileFromUploadForm(init.body);
            const useServerGlbUpload =
                storeInfo?.store === 'models' && file && shouldUseServerGlbUpload(init.body, file);
            if (useServerGlbUpload) {
                // GLB は fetch 経由でもサーバー POST /upload へ（R2 直アップロードしない）
            } else if (useR2) {
                const apiBase = extractApiBase(rewritten);
                if (apiBase && storeInfo && file) {
                    const result = await uploadFileViaR2(apiBase, storeInfo.store, file, {
                        allowOverwrite: urlHasConfirmOverwrite(rewritten),
                        forceFilename: storeInfo.forceFilename,
                    });
                    const status = result.status ?? (result.success ? 200 : 400);
                    const bodyJson = result.success
                        ? {
                              ...buildR2DirectUploadPayload(result, init.body),
                              ...(storeInfo.forceFilename
                                  ? { url: `/env/${storeInfo.forceFilename}` }
                                  : {}),
                          }
                        : { error: result.error };
                    return new Response(JSON.stringify(bodyJson), {
                        status,
                        headers: { 'Content-Type': 'application/json' },
                    });
                }
            }
        }

        if (rewritten !== url) {
            if (typeof input === 'string') {
                return origFetch(rewritten, init);
            }
            const req = new Request(rewritten, input instanceof Request ? input : undefined);
            return origFetch(req, init);
        }

        return origFetch(input, init);
    };
}
