// public/js/tenant-runtime-shim.js — テナント URL プレフィックスで fetch / XHR / API を書き換え

const TENANT_PATH_PREFIXES = ['/api/', '/models/', '/images/', '/pdfs/', '/env/', '/avatars/', '/simulations/'];

const TENANT_RELATIVE_PREFIXES = TENANT_PATH_PREFIXES.map((p) => p.slice(1));

/** tenant ID として無効な先頭セグメント */
const RESERVED_TENANT_SEGMENTS = new Set(['api', 'admin', 'css', 'js', 'dist', 'node_modules', '@vite', '@fs']);

/**
 * URL から tenant ID を取得（/P-01/ 形式）
 * @returns {string | null}
 */
export function getTenantIdFromPath() {
    const pathName = window.location.pathname;
    const adminMatch = pathName.match(/\/admin\/tenant\/([^/]+)/);
    if (adminMatch?.[1]) {
        return decodeURIComponent(adminMatch[1]);
    }
    const parts = pathName.split('/').filter(Boolean);
    if (parts.length < 1) return null;
    const id = parts[0];
    if (RESERVED_TENANT_SEGMENTS.has(id.toLowerCase())) return null;
    return id;
}

/**
 * テナント API ベースパス
 * @returns {string}
 */
export function getTenantBase() {
    const tenantId = getTenantIdFromPath();
    return tenantId ? `/${tenantId}` : '';
}

/**
 * パスがテナント付与対象か
 * @param {string} path
 */
function needsTenantAssetPrefix(path) {
    return TENANT_PATH_PREFIXES.some((p) => path.startsWith(p));
}

/**
 * 相対パスをテナント付き URL に変換
 * @param {string} url
 * @returns {string}
 */
export function toTenantUrl(url) {
    const raw = String(url || '');
    if (!raw) return raw;

    if (raw.startsWith('http://') || raw.startsWith('https://')) {
        try {
            const u = new URL(raw);
            if (typeof window !== 'undefined' && u.origin === window.location.origin) {
                const pathUrl = `${u.pathname}${u.search}${u.hash}`;
                const rewritten = toTenantUrl(pathUrl);
                if (rewritten !== pathUrl) {
                    return `${u.origin}${rewritten.startsWith('/') ? rewritten : `/${rewritten}`}`;
                }
            }
        } catch {
            /* ignore */
        }
        return raw;
    }

    const tenantBase = getTenantBase();
    if (!tenantBase) return raw;

    if (raw.startsWith('/')) {
        if (raw.startsWith(`${tenantBase}/`)) return raw;
        if (needsTenantAssetPrefix(raw)) return `${tenantBase}${raw}`;
        return raw;
    }

    if (TENANT_RELATIVE_PREFIXES.some((p) => raw.startsWith(p))) {
        return `${tenantBase}/${raw.replace(/^\/+/, '')}`;
    }

    return raw;
}

/**
 * fetch をテナント向けにラップ
 */
export function installTenantFetchShim() {
    if (window.__tenantFetchShimInstalled) return;
    window.__tenantFetchShimInstalled = true;

    const nativeFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        if (typeof input === 'string') {
            return nativeFetch(toTenantUrl(input), init);
        }
        if (input instanceof Request) {
            const nextUrl = toTenantUrl(input.url);
            if (nextUrl === input.url) return nativeFetch(input, init);
            return nativeFetch(new Request(nextUrl, input), init);
        }
        return nativeFetch(input, init);
    };
}

/**
 * GLTFLoader 等の XMLHttpRequest をテナント向けにラップ
 */
export function installTenantXhrShim() {
    if (window.__tenantXhrShimInstalled) return;
    window.__tenantXhrShimInstalled = true;

    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function open(method, url, ...rest) {
        const nextUrl = typeof url === 'string' ? toTenantUrl(url) : url;
        return origOpen.call(this, method, nextUrl, ...rest);
    };
}

installTenantFetchShim();
installTenantXhrShim();
