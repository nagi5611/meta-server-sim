// lib/tenant-asset-request-rel.js — Express 静的配信の相対パス正規化

/**
 * リクエスト path をローカル/R2 参照用の相対パスへ正規化する。
 * Express はマウント先以降の req.path を URL デコードしないため、%E4%B8... 形式のまま届く。
 * @param {string} rawPath req.path 等
 * @returns {string|null} 無効時は null（.. 含む・デコード失敗で危険な場合）
 */
export function normalizeTenantAssetRequestRel(rawPath) {
    let rel = String(rawPath || '')
        .replace(/^\/+/, '')
        .replace(/\\/g, '/');
    if (!rel) return '';

    if (rel.includes('%')) {
        try {
            rel = decodeURIComponent(rel);
        } catch {
            return null;
        }
    }

    if (typeof rel.normalize === 'function') {
        rel = rel.normalize('NFC');
    }

    if (rel.includes('..')) {
        return null;
    }

    return rel;
}