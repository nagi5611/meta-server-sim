// public/js/tenant-service-worker-register-shim.js — 管理画面では SW 未登録のため invalidate をブロックしない
import {
    registerMetaverseServiceWorker as registerMetaverseServiceWorkerCore,
} from '../../../metaverse-simple/public/js/service-worker-register.js';
import { toTenantUrl } from './tenant-runtime-shim.js';

export { registerMetaverseServiceWorkerCore as registerMetaverseServiceWorker };

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
        reg?.active?.postMessage({ type: 'INVALIDATE', urls: list });
    } catch {
        /* 管理画面では SW 未登録が通常 */
    }
}
