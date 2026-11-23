// public/js/tenant-world-view-distance.js — スポーンとモデル距離が描画距離を超えるテナント向け補正

const VIEW_DISTANCE_M_DEFAULT = 50;
const VIEW_DISTANCE_M_MAX = 10000;

/**
 * モデル config のおおよそのロード判定半径（scale ベース）
 * @param {{ scale?: { x?: number, y?: number, z?: number } }} cfg
 * @returns {number}
 */
export function estimateModelLoadRadius(cfg) {
    const scale = cfg?.scale || { x: 1, y: 1, z: 1 };
    const maxScale = Math.max(Math.abs(scale.x ?? 1), Math.abs(scale.y ?? 1), Math.abs(scale.z ?? 1), 1);
    return maxScale * 12;
}

/**
 * スポーンから全 models まで届くよう viewDistanceM を引き上げる（worlds.json は変更しない）
 * @param {{ graphicsOptions?: { viewDistanceM?: number } }} sceneManager
 * @param {{ spawnPoint?: { x?: number, y?: number, z?: number }, models?: unknown[] } | null} world
 * @returns {number|null} 適用後の viewDistanceM
 */
export function ensureViewDistanceCoversWorldModels(sceneManager, world) {
    if (!sceneManager?.graphicsOptions || !world) return null;
    const spawn = world.spawnPoint || { x: 0, y: 0, z: 0 };
    const models = Array.isArray(world.models) ? world.models : [];
    let required = Number(sceneManager.graphicsOptions.viewDistanceM);
    if (!Number.isFinite(required)) required = VIEW_DISTANCE_M_DEFAULT;

    for (const raw of models) {
        const cfg = typeof raw === 'string' ? { path: raw } : raw;
        if (!cfg || typeof cfg !== 'object') continue;
        const path = String(cfg.path || cfg.prefabManifest || '').trim();
        if (!path) continue;
        const pos = cfg.position || { x: 0, y: 0, z: 0 };
        const dx = (spawn.x ?? 0) - (pos.x ?? 0);
        const dy = (spawn.y ?? 0) - (pos.y ?? 0);
        const dz = (spawn.z ?? 0) - (pos.z ?? 0);
        const dist = Math.hypot(dx, dy, dz);
        required = Math.max(required, dist + estimateModelLoadRadius(cfg));
    }

    const capped = Math.min(VIEW_DISTANCE_M_MAX, Math.max(VIEW_DISTANCE_M_DEFAULT, required));
    if (capped > (sceneManager.graphicsOptions.viewDistanceM ?? VIEW_DISTANCE_M_DEFAULT)) {
        sceneManager.graphicsOptions.viewDistanceM = capped;
    }
    return sceneManager.graphicsOptions.viewDistanceM;
}