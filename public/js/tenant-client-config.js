// public/js/tenant-client-config.js — /api/client-config の単一 fetch（テナント URL 対応）

import { toTenantUrl } from './tenant-runtime-shim.js';

/** @type {Promise<unknown> | null} */
let configPromise = null;

/**
 * /api/client-config を一度だけ取得（portal / FDS / asset-resolve で共有）
 * @returns {Promise<unknown>}
 */
export function loadClientConfigOnce() {
    if (!configPromise) {
        configPromise = fetch(toTenantUrl('/api/client-config'), { credentials: 'include' }).then(
            (r) => r.json(),
        );
    }
    return configPromise;
}
