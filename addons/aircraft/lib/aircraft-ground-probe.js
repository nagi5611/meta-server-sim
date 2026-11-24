// addons/aircraft/lib/aircraft-ground-probe.js — Hard/Easy 共通の接地フォールバック（単体テスト可能）
export const GROUND_PROBE_ORIGIN_LIFT = 2;
export const CLEARANCE_ABOVE_GROUND = 0.5;
export const VERTICAL_MOVE_MARGIN = 0.02;

/**
 * @param {{ minY: number, headroom: number } | null} groundAfter
 * @param {number | null} lastGroundMinY
 * @param {number} worldY
 * @param {number} velocityY
 * @returns {{ minY: number | null, lastGroundMinY: number | null }}
 */
export function resolveGroundMinY(groundAfter, lastGroundMinY, worldY, velocityY) {
    let minY = groundAfter?.minY ?? null;
    if (minY != null) return { minY, lastGroundMinY: minY };
    if (lastGroundMinY != null && velocityY < 0 && worldY < lastGroundMinY) {
        return { minY: lastGroundMinY, lastGroundMinY };
    }
    return { minY, lastGroundMinY };
}

/**
 * @param {number} dy
 * @param {{ headroom: number } | null | undefined} groundBefore
 * @param {number} [margin]
 * @returns {number}
 */
export function clampVerticalDrop(dy, groundBefore, margin = VERTICAL_MOVE_MARGIN) {
    if (!groundBefore || dy >= 0) return dy;
    const maxDrop = Math.max(0, groundBefore.headroom - margin);
    return -Math.min(-dy, maxDrop);
}