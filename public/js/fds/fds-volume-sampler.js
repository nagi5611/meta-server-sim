// public/js/fds/fds-volume-sampler.js — FDS 煙ボリュームの CPU サンプリング（頭位置・曝露量用）

import * as THREE from 'three';

const _localScratch = new THREE.Vector3();
const _mirroredScratch = new THREE.Vector3();
const _extentScratch = new THREE.Vector3();

/**
 * ワールド座標を volume ローカル座標に変換する
 * @param {THREE.Vector3} worldPos
 * @param {ReturnType<import('./fds-volume-placement.js').computeFdsVolumePlacement>} placement
 * @param {THREE.Vector3} out
 */
export function worldPositionToVolumeLocal(worldPos, placement, out) {
    out.copy(worldPos).sub(placement.volumeOrigin);
    out.applyMatrix3(placement.volumeRotationInverse);
    return out;
}

/**
 * シェーダの mirrorLocalPos と同じ変換
 * @param {THREE.Vector3} localPos
 * @param {ReturnType<import('./fds-volume-placement.js').computeFdsVolumePlacement>} placement
 * @param {THREE.Vector3} out
 */
export function mirrorVolumeLocalPosition(localPos, placement, out) {
    const res = placement.volumeResolution;
    const vs = placement.voxelSize;
    _extentScratch.set(
        (res.x - 1) * vs.x,
        (res.y - 1) * vs.y,
        (res.z - 1) * vs.z,
    );
    out.copy(localPos);
    const sign = placement.volumeMirrorSign;
    if (sign.x < 0) out.x = _extentScratch.x - out.x;
    if (sign.y < 0) out.y = _extentScratch.y - out.y;
    if (sign.z < 0) out.z = _extentScratch.z - out.z;
    return out;
}

/**
 * 正規化 soot 密度を trilinear 補間でサンプル（ボリューム外は null）
 * @param {import('./fds-volume-loader.js').FdsSmokeManifest} manifest
 * @param {ReturnType<import('./fds-volume-placement.js').computeFdsVolumePlacement>} placement
 * @param {Uint8Array} volumeData
 * @param {number} localFrameIndex パート内または全体のフレームインデックス
 * @param {THREE.Vector3} worldPos
 * @returns {number | null}
 */
export function sampleNormalizedSootAtWorld(manifest, placement, volumeData, localFrameIndex, worldPos) {
    const [nx, ny, nz] = manifest.dims;
    const voxelsPerFrame = nx * ny * nz;

    worldPositionToVolumeLocal(worldPos, placement, _localScratch);
    mirrorVolumeLocalPosition(_localScratch, placement, _mirroredScratch);

    const vs = placement.voxelSize;
    const res = placement.volumeResolution;
    const vx = _mirroredScratch.x / vs.x;
    const vz = _mirroredScratch.y / vs.y;
    const vy = _mirroredScratch.z / vs.z;

  // グリッド外は null。境界付近は描画（ボクセル補間）に合わせてクランプする
    if (vx < -0.5 || vy < -0.5 || vz < -0.5 || vx > nx - 0.5 || vy > ny - 0.5 || vz > nz - 0.5) {
        return null;
    }

    const cx = Math.max(0, Math.min(nx - 1, vx));
    const cy = Math.max(0, Math.min(ny - 1, vy));
    const cz = Math.max(0, Math.min(nz - 1, vz));

    const x0 = Math.floor(cx);
    const y0 = Math.floor(cy);
    const z0 = Math.floor(cz);
    const x1 = Math.min(x0 + 1, nx - 1);
    const y1 = Math.min(y0 + 1, ny - 1);
    const z1 = Math.min(z0 + 1, nz - 1);
    const tx = cx - x0;
    const ty = cy - y0;
    const tz = cz - z0;

    const frame = Math.max(0, Math.floor(localFrameIndex));
    const frameBase = frame * voxelsPerFrame;

    /**
     * @param {number} xi
     * @param {number} yi
     * @param {number} zi
     */
    const readVoxel = (xi, yi, zi) => {
        // export / VolumeRenderer: index = xi + atlasZi*nx + atlasYi*nx*ny（atlasYi=nz, atlasZi=ny）
        // ここでは yi=local.z→ny、zi=local.y→nz
        const index = frameBase + xi + yi * nx + zi * nx * ny;
        return volumeData[index] / 255;
    };

    let value = 0;
    for (let dz = 0; dz <= 1; dz++) {
        const zi = dz ? z1 : z0;
        const wz = dz ? tz : 1 - tz;
        for (let dy = 0; dy <= 1; dy++) {
            const yi = dy ? y1 : y0;
            const wy = dy ? ty : 1 - ty;
            for (let dx = 0; dx <= 1; dx++) {
                const xi = dx ? x1 : x0;
                const wx = dx ? tx : 1 - tx;
                value += readVoxel(xi, yi, zi) * wx * wy * wz;
            }
        }
    }

    return value;
}

/** 描画の minCutoff 相当：これ以上で「煙内」とみなす */
export const SMOKE_INSIDE_NORMALIZED_THRESHOLD = 1e-3;

/**
 * 正規化密度を manifest.valueMax で物理量へ（SOOT DENSITY 等）
 * @param {number | null} normalized
 * @param {import('./fds-volume-loader.js').FdsSmokeManifest} manifest
 * @returns {number | null}
 */
export function normalizedSootToPhysical(normalized, manifest) {
    if (normalized == null) return null;
    const max = Number(manifest?.valueMax);
    if (!Number.isFinite(max) || max <= 0) return normalized;
    return normalized * max;
}
