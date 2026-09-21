// public/js/fds/fds-smoke-fetch-client.js — バルクオリジン + Worker 経由の煙バイナリ取得

import FdsSmokeFetchWorker from './fds-smoke-fetch.worker.js?worker';
import { fdsSmokeBulkOriginMatchesPage } from '../../../lib/fds-smoke-origin-match.js';
import { toTenantUrl } from '../tenant-runtime-shim.js';
import { loadClientConfigOnce } from '../tenant-client-config.js';

/** @see lib/tenant-metaverse-http-auth.js TENANT_SOCKET_AUTH_QUERY */
const HTTP_AUTH_QUERY = 'mvsauth';

/** @type {string | null} */
let bulkOrigin = null;
/** @type {string | null} */
let httpAuthToken = null;
/** @type {Worker | null} */
let workerInstance = null;
let workerDisabled = false;
let nextRequestId = 1;

/**
 * バルク配信オリジンを設定する
 * @param {string | null | undefined} origin
 */
export function setFdsSmokeBulkOrigin(origin) {
    bulkOrigin = origin ? String(origin).replace(/\/+$/, '') : null;
}

/**
 * client-config から HTTP 認証とバルクオリジンを読み込む
 * @returns {Promise<void>}
 */
export async function ensureFdsSmokeBulkConfig() {
    try {
        const cfg = await loadClientConfigOnce();
        if (!cfg || typeof cfg !== 'object') {
            return;
        }
        if (typeof cfg.httpAuthToken === 'string' && cfg.httpAuthToken.trim()) {
            httpAuthToken = cfg.httpAuthToken.trim();
        }
        if (cfg.fdsSmokeBulk?.enabled && cfg.fdsSmokeBulk.origin) {
            setFdsSmokeBulkOrigin(cfg.fdsSmokeBulk.origin);
        }
    } catch {
        /* 同一オリジン配信にフォールバック */
    }
}

/**
 * @param {string} fetchUrl
 * @returns {boolean}
 */
function needsQueryAuthForUrl(fetchUrl) {
    if (!httpAuthToken || typeof window === 'undefined') {
        return false;
    }
    try {
        const target = new URL(fetchUrl, window.location.href);
        return target.origin !== window.location.origin;
    } catch {
        return false;
    }
}

/**
 * FDS 煙 fetch 用 URL（認証クエリ付与）
 * @param {string} fetchUrl
 * @param {{ forceQueryAuth?: boolean }} [options] — Worker は Cookie を送れないため true
 * @returns {string}
 */
export function withFdsSmokeHttpAuth(fetchUrl, options = {}) {
    if (!httpAuthToken) {
        return fetchUrl;
    }
    const useQuery = options.forceQueryAuth === true || needsQueryAuthForUrl(fetchUrl);
    if (!useQuery) {
        return fetchUrl;
    }
    const sep = fetchUrl.includes('?') ? '&' : '?';
    return `${fetchUrl}${sep}${HTTP_AUTH_QUERY}=${encodeURIComponent(httpAuthToken)}`;
}

/**
 * 煙バイナリ URL を解決する（バルクオリジンがページと一致する時だけ付与）
 * @param {string} assetPath
 * @returns {string}
 */
export function resolveFdsSmokeBinaryUrl(assetPath) {
    const normalized = assetPath.startsWith('/') ? assetPath : `/${assetPath}`;
    const tenantPath = toTenantUrl(normalized);
    if (
        bulkOrigin &&
        typeof window !== 'undefined' &&
        fdsSmokeBulkOriginMatchesPage(bulkOrigin, window.location.origin)
    ) {
        return `${bulkOrigin}${tenantPath}`;
    }
    return tenantPath;
}

/**
 * @returns {Worker | null}
 */
function getFetchWorker() {
    if (workerDisabled) {
        return null;
    }
    if (!workerInstance) {
        try {
            workerInstance = new FdsSmokeFetchWorker();
            workerInstance.onerror = () => {
                workerDisabled = true;
            };
        } catch {
            workerDisabled = true;
            return null;
        }
    }
    return workerInstance;
}

/**
 * メインスレッドでバイナリを取得する
 * @param {string} fetchUrl
 * @returns {Promise<Uint8Array>}
 */
async function fetchFdsSmokeBinaryOnMainThread(fetchUrl) {
    const url = withFdsSmokeHttpAuth(fetchUrl);
    const init = needsQueryAuthForUrl(fetchUrl) ? undefined : { credentials: 'include' };
    const response = await fetch(url, init);
    if (!response.ok) {
        throw new Error(`Failed to load volume data (${response.status}): ${fetchUrl}`);
    }
    return new Uint8Array(await response.arrayBuffer());
}

/**
 * Worker 経由でバイナリを取得する
 * @param {Worker} worker
 * @param {string} fetchUrl
 * @returns {Promise<Uint8Array>}
 */
function fetchFdsSmokeBinaryViaWorker(worker, fetchUrl) {
    const requestId = nextRequestId++;
    const authedUrl = withFdsSmokeHttpAuth(fetchUrl, { forceQueryAuth: true });
    return new Promise((resolve, reject) => {
        const onMessage = (event) => {
            const data = event.data;
            if (!data || data.id !== requestId) {
                return;
            }
            worker.removeEventListener('message', onMessage);
            if (data.ok && data.buffer) {
                resolve(new Uint8Array(data.buffer));
                return;
            }
            reject(new Error(data.error || `Failed to load volume data: ${fetchUrl}`));
        };

        worker.addEventListener('message', onMessage);
        worker.postMessage({ type: 'fetch', id: requestId, url: authedUrl });
    });
}

/**
 * FDS 煙バイナリを取得する（Worker 優先、失敗時はメインスレッド）
 * @param {string} assetPath simulations/... 形式のテナント相対パス
 * @returns {Promise<Uint8Array>}
 */
export async function fetchFdsSmokeBinary(assetPath) {
    await ensureFdsSmokeBulkConfig();
    const fetchUrl = resolveFdsSmokeBinaryUrl(assetPath);

    const worker = getFetchWorker();
    if (!worker) {
        return fetchFdsSmokeBinaryOnMainThread(fetchUrl);
    }

    try {
        return await fetchFdsSmokeBinaryViaWorker(worker, fetchUrl);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const isNetworkFailure =
            message === 'Failed to fetch' ||
            message.includes('NetworkError') ||
            message.toLowerCase().includes('fetch failed');
        if (!isNetworkFailure) {
            throw error;
        }
        workerDisabled = true;
        return fetchFdsSmokeBinaryOnMainThread(fetchUrl);
    }
}
