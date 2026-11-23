// public/js/tenant-pdfjs-get-document-shim.js — pdf.js: Vite が pdfjs-dist を tenant-pdfjs-dist-entry へ差し替え済み
/**
 * 互換のため残す。ESM 名前空間への代入は行わない。
 * @returns {Promise<void>}
 */
export function installTenantPdfjsGetDocumentShim() {
    if (typeof window !== 'undefined') {
        window.__tenantPdfjsGetDocumentShimInstalled = true;
    }
    return Promise.resolve();
}