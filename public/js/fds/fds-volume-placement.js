// public/js/fds/fds-volume-placement.js — FDS volume の位置・スケール・回転計算

import * as THREE from 'three';

const _fdsEuler = new THREE.Euler();
const _fdsRotMat4 = new THREE.Matrix4();
const _fdsRotMat3 = new THREE.Matrix3();
const _fdsRotMat3Inv = new THREE.Matrix3();

/**
 * 回転（度・XYZ）から volume ローカル→ワールドの回転行列を構築する
 * @param {{ x?: number, y?: number, z?: number }} [rotationDeg]
 * @returns {{ rotation: THREE.Matrix3, rotationInverse: THREE.Matrix3 }}
 */
export function buildFdsVolumeRotationMatrices(rotationDeg = {}) {
    _fdsEuler.set(
        ((rotationDeg.x ?? 0) * Math.PI) / 180,
        ((rotationDeg.y ?? 0) * Math.PI) / 180,
        ((rotationDeg.z ?? 0) * Math.PI) / 180,
        'XYZ',
    );
    _fdsRotMat4.makeRotationFromEuler(_fdsEuler);
    _fdsRotMat3.setFromMatrix4(_fdsRotMat4);
    _fdsRotMat3Inv.copy(_fdsRotMat3).invert();
    return { rotation: _fdsRotMat3.clone(), rotationInverse: _fdsRotMat3Inv.clone() };
}

/**
 * FDS 煙のミラー反転フラグを正規化する
 * @param {{ x?: boolean, y?: boolean, z?: boolean }} [mirror]
 */
export function normalizeFdsVolumeMirror(mirror = {}) {
    return {
        x: mirror.x === true,
        y: mirror.y === true,
        z: mirror.z === true,
    };
}

/**
 * ミラー反転フラグからシェーダ用の符号ベクトル（1 または -1）を構築する
 * @param {{ x?: boolean, y?: boolean, z?: boolean }} [mirror]
 */
export function buildFdsVolumeMirrorSign(mirror = {}) {
    const m = normalizeFdsVolumeMirror(mirror);
    return new THREE.Vector3(m.x ? -1 : 1, m.y ? -1 : 1, m.z ? -1 : 1);
}

/**
 * FDS bounds + transform からワールド座標の volumeOrigin / voxelSize / 回転を算出する
 * @param {{ dims: number[], bounds: { x: number[], y: number[], z: number[] } }} manifest
 * @param {{ position?: { x?: number, y?: number, z?: number }, rotation?: { x?: number, y?: number, z?: number }, scale?: number, mirror?: { x?: boolean, y?: boolean, z?: boolean } }} [transform]
 */
export function computeFdsVolumePlacement(manifest, transform = {}) {
    const [nx, ny, nz] = manifest.dims;
    const bounds = manifest.bounds;
    const scale = transform.scale ?? 1;
    const position = transform.position ?? { x: 0, y: 0, z: 0 };

    const dx = bounds.x[1] - bounds.x[0];
    const dy = bounds.y[1] - bounds.y[0];
    const dz = bounds.z[1] - bounds.z[0];

    const volumeOrigin = new THREE.Vector3(position.x, position.y, position.z);

    const voxelSize = new THREE.Vector3(
        (dx / Math.max(nx - 1, 1)) * scale,
        (dz / Math.max(nz - 1, 1)) * scale,
        (dy / Math.max(ny - 1, 1)) * scale,
    );

    const volumeResolution = new THREE.Vector3(nx, nz, ny);
    const { rotation, rotationInverse } = buildFdsVolumeRotationMatrices(transform.rotation);
    const volumeMirrorSign = buildFdsVolumeMirrorSign(transform.mirror);

    return {
        volumeOrigin,
        voxelSize,
        volumeResolution,
        volumeRotation: rotation,
        volumeRotationInverse: rotationInverse,
        volumeMirrorSign,
    };
}

/**
 * VolumeRenderer に配置（位置・スケール・回転）を反映する
 * @param {{ uniforms: Record<string, { value: unknown }> }} volumeRenderer
 * @param {ReturnType<typeof computeFdsVolumePlacement>} placement
 */
export function applyVolumePlacementToRenderer(volumeRenderer, placement) {
    volumeRenderer.uniforms.volumeOrigin.value.copy(placement.volumeOrigin);
    volumeRenderer.uniforms.voxelSize.value.copy(placement.voxelSize);
    volumeRenderer.uniforms.volumeRotation.value.copy(placement.volumeRotation);
    volumeRenderer.uniforms.volumeRotationInverse.value.copy(placement.volumeRotationInverse);
    volumeRenderer.uniforms.volumeMirrorSign.value.copy(placement.volumeMirrorSign);
}
