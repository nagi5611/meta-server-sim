// lib/tenant-worlds-validate.js — POST worlds 用の最小検証（metaverse-simple server.js より）

/**
 * @param {Record<string, unknown>} worlds
 * @returns {string[]}
 */
export function validateWorldsPhysicsAssist(worlds) {
    const errors = [];
    if (!worlds || typeof worlds !== 'object') return errors;
    for (const [wid, w] of Object.entries(worlds)) {
        if (!w || typeof w !== 'object') continue;
        const pa = w.physicsAssist;
        if (!pa || typeof pa !== 'object') continue;
        const min = pa.minFeetY;
        const max = pa.maxFeetY;
        const hasMin = typeof min === 'number' && Number.isFinite(min);
        const hasMax = typeof max === 'number' && Number.isFinite(max);
        if (hasMin && hasMax && min > max) {
            errors.push(`ワールド「${wid}」: physicsAssist の minFeetY は maxFeetY 以下にしてください`);
        }
    }
    return errors;
}

/**
 * @param {Record<string, unknown>} worlds
 * @returns {string[]}
 */
export function validateWorldsFloorDimensions(worlds) {
    const errors = [];
    if (!worlds || typeof worlds !== 'object') return errors;
    const lo = 10;
    const hi = 200000;
    for (const [wid, w] of Object.entries(worlds)) {
        if (!w || typeof w !== 'object') continue;
        for (const key of ['floorWidth', 'floorDepth']) {
            if (!(key in w)) continue;
            const v = w[key];
            if (typeof v !== 'number' || !Number.isFinite(v)) {
                errors.push(`ワールド「${wid}」: ${key} は有限の数値にしてください`);
                continue;
            }
            if (v < lo || v > hi) {
                errors.push(`ワールド「${wid}」: ${key} は ${lo}〜${hi}（m）にしてください`);
            }
        }
    }
    return errors;
}

/**
 * @param {Record<string, unknown>} worlds
 * @returns {string[]}
 */
export function validateWorldsPlayBoundsAndColliders(worlds) {
    const errors = [];
    if (!worlds || typeof worlds !== 'object') return errors;
    for (const [wid, w] of Object.entries(worlds)) {
        if (!w || typeof w !== 'object') continue;
        const pb = w.playBounds;
        if (pb != null) {
            if (typeof pb !== 'object' || !pb.min || !pb.max) {
                errors.push(`ワールド「${wid}」: playBounds は { min:{x,y,z}, max:{x,y,z} } 形式にしてください`);
                continue;
            }
            const axes = ['x', 'y', 'z'];
            for (const ax of axes) {
                if (!(ax in pb.min) || !(ax in pb.max)) {
                    errors.push(`ワールド「${wid}」: playBounds.min/max に ${ax} が必要です`);
                    continue;
                }
                const a = pb.min[ax];
                const b = pb.max[ax];
                if (typeof a !== 'number' || typeof b !== 'number' || !Number.isFinite(a) || !Number.isFinite(b)) {
                    errors.push(`ワールド「${wid}」: playBounds.min/max の ${ax} は有限数値にしてください`);
                } else if (a > b) {
                    errors.push(`ワールド「${wid}」: playBounds の min.${ax} は max.${ax} 以下にしてください`);
                }
            }
        }
        const colliders = w.serverColliders;
        if (colliders != null) {
            if (!Array.isArray(colliders)) {
                errors.push(`ワールド「${wid}」: serverColliders は配列にしてください`);
                continue;
            }
            colliders.forEach((c, i) => {
                if (!c || typeof c !== 'object' || !c.min || !c.max) {
                    errors.push(`ワールド「${wid}」: serverColliders[${i}] の形が不正です`);
                }
            });
        }
    }
    return errors;
}
