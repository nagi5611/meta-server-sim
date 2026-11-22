// lib/r2/r2-mirror-prefix.js — meta/models → テナント models キー変換

import { toR2Key } from './r2-keys.js';

/** S3→R2 共有プレフィックス（読み取り専用・変更しない） */
export const META_MODELS_SOURCE_PREFIX = 'meta/models/';

/**
 * ETag 比較用に引用符を除去する
 * @param {string | undefined} etag
 * @returns {string}
 */
export function normalizeEtag(etag) {
    return String(etag ?? '')
        .trim()
        .replace(/^"+|"+$/g, '');
}

/**
 * 共有 meta/models キーをテナント models キーへ変換する
 * @param {string} tenantId
 * @param {string} sourceKey
 * @returns {string | null} ディレクトリマーカー等は null
 */
export function mapMetaModelsKeyToTenantModelsKey(tenantId, sourceKey) {
    const key = String(sourceKey || '');
    if (!key.startsWith(META_MODELS_SOURCE_PREFIX)) {
        throw new Error(`Source key must start with ${META_MODELS_SOURCE_PREFIX}`);
    }
    const rel = key.slice(META_MODELS_SOURCE_PREFIX.length);
    if (!rel || rel.endsWith('/')) {
        return null;
    }
    return toR2Key(tenantId, 'models', rel);
}

/**
 * 先方に同一オブジェクトが既にあるか（上書きなし判定）
 * @param {{ etag?: string, size: number } | null} destHead
 * @param {{ etag?: string, size: number } | null} sourceHead
 * @returns {'skip-identical' | 'skip-exists' | 'copy'}
 */
export function decideMirrorAction(destHead, sourceHead) {
    if (!destHead) {
        return 'copy';
    }
    const sourceEtag = normalizeEtag(sourceHead?.etag);
    const destEtag = normalizeEtag(destHead.etag);
    const sourceSize = sourceHead?.size ?? 0;
    if (destEtag && sourceEtag && destEtag === sourceEtag && destHead.size === sourceSize) {
        return 'skip-identical';
    }
    return 'skip-exists';
}