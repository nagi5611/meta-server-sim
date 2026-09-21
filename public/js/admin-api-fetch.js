// public/js/admin-api-fetch.js — 管理 API 向け fetch（metaverse-simple 同等）
import { rewriteTenantWorldEditApiUrl } from './tenant-world-edit-api-paths.js';

export const ADMIN_CSRF_HEADER = 'X-Admin-CSRF';

/** @type {string|null} */
let cachedToken = null;
/** @type {number} */
let cachedExpiresAt = 0;
/** @type {Promise<void>|null} */
let initPromise = null;

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** @type {typeof fetch} */
let nativeFetch =
    typeof window !== 'undefined' ? window.fetch.bind(window) : fetch;

/**
 * リクエスト URL 文字列を正規化する
 * @param {RequestInfo | URL} input
 * @returns {string}
 */
function toUrlString(input) {
    if (typeof input === 'string') return input;
    if (input instanceof URL) return input.pathname + input.search;
    if (input instanceof Request) return input.url;
    return String(input);
}

/**
 * 認証情報を含まない同一オリジンの絶対 URL に解決する
 * @param {RequestInfo | URL} input
 * @returns {string | RequestInfo | URL}
 */
function resolveAdminRequestUrl(input) {
    const urlStr = toUrlString(input);
    if (!urlStr.startsWith('/admin') && !urlStr.startsWith('/host-monitor')) {
        return input;
    }

    const path = urlStr.startsWith('http')
        ? new URL(urlStr).pathname + new URL(urlStr).search
        : urlStr;
    const origin = `${window.location.protocol}//${window.location.host}`;
    return `${origin}${path}`;
}

/**
 * URL が管理 API 向け fetch ラップ対象か
 * @param {string} url
 */
function needsAdminFetch(url) {
    return url.startsWith('/admin') || url.startsWith('/host-monitor');
}

/**
 * CSRF トークンを取得・キャッシュする
 * @returns {Promise<void>}
 */
export async function initAdminCsrf() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
        const res = await adminFetch('/admin/csrf-token', { credentials: 'include' });
        if (!res.ok) {
            if (res.status === 401) {
                throw new Error('認証に失敗しました。ユーザー名・パスワードを確認してください。');
            }
            throw new Error(`CSRF token fetch failed: ${res.status}`);
        }
        const data = await res.json();
        cachedToken = String(data?.token || '');
        cachedExpiresAt = Number(data?.expiresAt) || 0;
        if (!cachedToken) {
            throw new Error('CSRF token missing in response');
        }
    })();
    return initPromise;
}

async function ensureCsrfToken() {
    const now = Date.now();
    if (cachedToken && cachedExpiresAt > now + 60_000) return;
    initPromise = null;
    await initAdminCsrf();
}

/**
 * XHR 向け CSRF トークン（bootstrapAdminApi 完了後に利用）
 * @returns {string}
 */
export function getAdminCsrfTokenSync() {
    return cachedToken || '';
}

/**
 * 管理 API 向け fetch
 * @param {RequestInfo | URL} url
 * @param {RequestInit} [init]
 * @returns {Promise<Response>}
 */
async function performAdminFetch(urlStr, init, headers) {
    const resolvedUrl = resolveAdminRequestUrl(urlStr);
    return nativeFetch(resolvedUrl, {
        ...init,
        credentials: init.credentials ?? 'include',
        headers,
    });
}

export async function adminFetch(url, init = {}) {
    const urlStr = rewriteTenantWorldEditApiUrl(toUrlString(url));
    const method = String(init.method || 'GET').toUpperCase();
    const headers = new Headers(init.headers || {});

    const needsCsrf = needsAdminFetch(urlStr) && MUTATING.has(method);
    if (needsCsrf) {
        await ensureCsrfToken();
        if (cachedToken) {
            headers.set(ADMIN_CSRF_HEADER, cachedToken);
        }
    }

    let res = await performAdminFetch(urlStr, init, headers);

    if (needsCsrf && res.status === 403) {
        try {
            const data = await res.clone().json();
            if (data?.error === 'csrf_invalid') {
                cachedToken = null;
                cachedExpiresAt = 0;
                initPromise = null;
                await ensureCsrfToken();
                const retryHeaders = new Headers(init.headers || {});
                if (cachedToken) {
                    retryHeaders.set(ADMIN_CSRF_HEADER, cachedToken);
                }
                res = await performAdminFetch(urlStr, init, retryHeaders);
            }
        } catch {
            /* non-JSON 403 */
        }
    }

    return res;
}

/**
 * 既存 fetch を /admin 向けにラップする
 */
export function installAdminFetchPatch() {
    if (typeof window === 'undefined' || window.__adminFetchPatched) return;
    nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        const originalUrl = toUrlString(input);
        const urlStr = rewriteTenantWorldEditApiUrl(originalUrl);
        if (needsAdminFetch(urlStr)) {
            return adminFetch(urlStr, init);
        }
        if (urlStr !== originalUrl) {
            return nativeFetch(urlStr, init);
        }
        return nativeFetch(input, init);
    };
    window.__adminFetchPatched = true;
    window.adminFetch = adminFetch;
}
