// public/js/client-spawn-registry.js — テナントゲーム向け NFC 等の入場スポーン拡張ポイント

/** @type {(() => Promise<object|null>)|null} */
let resolver = null;

/** @type {((app: object, plan: object) => Promise<void>)|null} */
let applier = null;

/**
 * @param {() => Promise<object|null>} fn
 */
export function registerClientSpawnResolver(fn) {
    resolver = fn;
}

/**
 * @param {(app: object, plan: object) => Promise<void>} fn
 */
export function registerClientSpawnApplier(fn) {
    applier = fn;
}

/**
 * @returns {Promise<object|null>}
 */
export async function tryResolveClientSpawn() {
    if (!resolver) return null;
    try {
        return await resolver();
    } catch (e) {
        console.warn('[spawn-registry] resolve failed:', e);
        return null;
    }
}

/**
 * @param {object} app
 * @param {object} plan
 */
export async function applyClientSpawnPlan(app, plan) {
    if (!applier || !plan) return;
    try {
        await applier(app, plan);
    } catch (e) {
        console.warn('[spawn-registry] apply failed:', e);
    }
}