// public/js/tenant-pdfjs-get-document-shim.js — pdf.js getDocument へテナント URL・エンコードを統一適用

import { resolveTenantAssetFetchUrl } from './tenant-pdf-asset-url.js';

/** @type {Promise<void> | null} */
let installPromise = null;

/**
 * pdfjs-dist の getDocument が渡す URL を SIM 共通のテナント付きパスへ書き換える
 * @returns {Promise<void>}
 */
export function installTenantPdfjsGetDocumentShim() {
    if (typeof window === 'undefined') {
        return Promise.resolve();
    }
    if (window.__tenantPdfjsGetDocumentShimInstalled) {
        return installPromise ?? Promise.resolve();
    }
    window.__tenantPdfjsGetDocumentShimInstalled = true;

    installPromise = import('pdfjs-dist')
        .then((pdfjsLib) => {
            const mod = pdfjsLib.default || pdfjsLib;
            if (!mod || typeof mod.getDocument !== 'function' || mod.getDocument.__tenantShimWrapped) {
                return;
            }
            const originalGetDocument = mod.getDocument.bind(mod);
            const wrapped = function tenantGetDocument(src, ...rest) {
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
            };
            wrapped.__tenantShimWrapped = true;
            mod.getDocument = wrapped;
        })
        .catch((err) => {
            console.warn('[tenant-pdfjs-shim] pdfjs-dist unavailable:', err);
        });

    return installPromise;
}