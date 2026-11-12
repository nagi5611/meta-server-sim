// public/js/tenant-service-worker-register-shim.js — 管理画面では SW 未登録のため invalidate をブロックしない
import {
    registerMetaverseServiceWorker as registerMetaverseServiceWorkerCore,
} from '../../../metaverse-simple/public/js/service-worker-register.js';
import { getTenantIdFromPath, toTenantUrl } from './tenant-runtime-shim.js';

export { registerMetaverseServiceWorkerCore as registerMetaverseServiceWorker };

/**
 * GLB 専用 cache-first SW（テナントスコープ）
 */
export async function registerTenantAssetCacheServiceWorker() {
    const tenantId = getTenantIdFromPath();
    if (!tenantId || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
        return;
    }
    const swUrl = `/${encodeURIComponent(tenantId)}/tenant-asset-cache-sw.js`;
    const scope = `/${encodeURIComponent(tenantId)}/`;
    try {
        await navigator.serviceWorker.register(swUrl, { scope });
    } catch (err) {
        console.warn('[tenant-asset-cache-sw] register failed:', err);
    }
}

/**
 * @param {string} assetPath
 * @returns {string}
 */
export function encodeAssetPathToUrlPath(assetPath) {
    const pathStr = assetPath.startsWith('/') ? assetPath.slice(1) : assetPath;
    const encodedPath = pathStr.split('/').map((seg) => encodeURIComponent(seg)).join('/');
    return toTenantUrl(`/${encodedPath}`);
}

const SW_READY_TIMEOUT_MS = 1500;

/**
 * SW が無い／ready しない環境（tenant ワールド編集など）でアップロードが止まらないようタイムアウト付き
 * @param {string[]} urls
 */
export async function notifyServiceWorkerInvalidate(urls) {
    const list = (urls || []).filter((u) => typeof u === 'string' && u.length > 0);
    if (!list.length || !('serviceWorker' in navigator)) return;

    try {
        const reg = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error('service_worker_ready_timeout')), SW_READY_TIMEOUT_MS);
            }),
        ]);
        const message = { type: 'INVALIDATE', urls: list };
        reg?.active?.postMessage(message);
        const tenantReg = (await navigator.serviceWorker.getRegistrations()).find((r) =>
            r.active?.scriptURL?.includes('tenant-asset-cache-sw.js'),
        );
        tenantReg?.active?.postMessage(message);
    } catch {
        /* 管理画面では SW 未登録が通常 */
    }
}
