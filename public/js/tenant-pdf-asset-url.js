// public/js/tenant-pdf-asset-url.js — SIM 共通: 論理アセットパスを fetch 用 URL に変換

import { sameOriginPathForAssetLogicalPath } from './tenant-asset-resolve.js';

/**
 * PDF / 静的アセットの論理パスまたは絶対パスを、テナント付き同一オリジン URL に変換する
 * @param {string} pathOrUrl 例: pdfs/foo.pdf, /pdfs/foo.pdf
 * @returns {string}
 */
export function resolveTenantAssetFetchUrl(pathOrUrl) {
    const raw = String(pathOrUrl || '').trim();
    if (!raw) return raw;

    if (raw.startsWith('http://') || raw.startsWith('https://')) {
        try {
            const u = new URL(raw);
            if (typeof window !== 'undefined' && u.origin === window.location.origin) {
                const logical = u.pathname.replace(/^\/+/, '');
                if (logical) {
                    return sameOriginPathForAssetLogicalPath(`${logical}${u.search}${u.hash}`);
                }
            }
        } catch {
            /* fall through */
        }
        return raw;
    }

    const logical = raw.replace(/^\/+/, '');
    return sameOriginPathForAssetLogicalPath(logical);
}