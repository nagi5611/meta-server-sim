// public/js/tenant-asset-resolve.js — テナントベースパス付き asset-resolve ラッパー
import * as core from '@metaverse-simple/asset-resolve-original';
import { toTenantUrl } from './tenant-runtime-shim.js';
import { loadClientConfigOnce } from './tenant-client-config.js';

core.setLoadClientConfigOnceFn(loadClientConfigOnce);

export { loadClientConfigOnce };
export const getAssetModelsConfig = core.getAssetModelsConfig;
export const prefetchSignedAssetHrefs = core.prefetchSignedAssetHrefs;

/**
 * 論理パスを同一オリジン URL にし、テナントプレフィックスを付与する
 * @param {string} pathStr
 * @returns {string}
 */
export function sameOriginPathForAssetLogicalPath(pathStr) {
    return toTenantUrl(core.sameOriginPathForAssetLogicalPath(pathStr));
}

/**
 * モデルアセット URL をテナントスコープで解決する
 * @param {string} pathOrUrl
 * @returns {Promise<string>}
 */
export async function resolveModelAssetHref(pathOrUrl) {
    const href = await core.resolveModelAssetHref(pathOrUrl);
    return toTenantUrl(href);
}

/**
 * 環境マップ URL をテナントスコープで解決する
 * @param {string} pathOrUrl
 * @returns {Promise<string>}
 */
export async function resolveEnvAssetHref(pathOrUrl) {
    const href = await core.resolveEnvAssetHref(pathOrUrl);
    return toTenantUrl(href);
}
