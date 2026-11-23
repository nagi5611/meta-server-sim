// public/js/tenant-pdfjs-get-document-impl.js — pdfjs getDocument ラッパー（ESM 名前空間は書き換えない）
import { getDocument as originalGetDocument } from 'pdfjs-dist-original';
import { resolveTenantAssetFetchUrl } from './tenant-pdf-asset-url.js';

/**
 * テナント付き URL へ正規化して pdf.js getDocument を呼ぶ
 * @param {Parameters<typeof originalGetDocument>[0]} src
 * @param {...unknown} rest
 */
export function tenantGetDocument(src, ...rest) {
    if (typeof src === 'string') {
        return originalGetDocument(resolveTenantAssetFetchUrl(src), ...rest);
    }
    if (src && typeof src === 'object' && typeof src.url === 'string') {
        return originalGetDocument(
            { ...src, url: resolveTenantAssetFetchUrl(src.url) },
            ...rest,
        );
    }
    return originalGetDocument(src, ...rest);
}